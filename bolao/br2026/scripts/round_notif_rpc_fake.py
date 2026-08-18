"""round_notif_rpc_fake.py — dublê fiel das RPCs de 030_br_round_notification_durability.sql.

NÃO é um arquivo de teste (sem prefixo test_) — é suporte de teste, importado por
test_recipient_completeness.py e pela suíte de durabilidade fresh-runner.

`FakeRoundNotifStore` modela "o banco": um dict que sobrevive ao descarte de qualquer
`AtomicRoundLedgerRepo`/caller criado sobre ele — exatamente o que um runner efêmero do GitHub
Actions faz (processo novo, banco igual). Isso é o que torna um teste "fresh runner" honesto:
cada "execução" deve receber um `AtomicRoundLedgerRepo` NOVO (via `S._ROUND_RPC_CALLER` apontando
para `make_round_rpc_caller(store)`), nunca reusar o objeto repo entre execuções — reusar o objeto
provaria só que a lógica em memória está certa, que nunca foi o defeito real.

A semântica replicada aqui tem de continuar batendo com a migração de verdade:
  - claim: só reivindica de READY/PARTIAL/FAILED, e só se lease_until é nulo ou já passou.
  - upsert: grava o registro inteiro (equivalente ao `insert ... on conflict ... do update`).
  - entryRef não pode ser um endereço de e-mail (mesma validação da RPC real).
Ver bolao/shared/sql/030_br_round_notification_durability.sql para a fonte da verdade.
"""
import threading
from datetime import datetime, timedelta, timezone

CLAIMABLE_STATES = ("READY", "PARTIAL", "FAILED")


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


def _parse(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if isinstance(s, str) else s


class FakeRoundNotifStore:
    """'O banco'. Sobrevive ao descarte de qualquer caller/repo criado sobre ele.

    `_lock` existe porque um dict Python nao da, de graca, a atomicidade que uma linha de Postgres
    da via lock de linha automatico. Sem ele, dois threads concorrentes poderiam ambos passar pela
    checagem "estado reivindicavel" de `claim()` antes de qualquer um escrever -- exatamente a
    janela que a RPC real fecha com um UPDATE de instrucao unica. O lock aqui existe para o dublê
    dar a MESMA garantia, nao para esconder uma race que a RPC real nao teria.
    """

    def __init__(self):
        self.rows = {}          # idempotency_key -> row (snake_case, como a tabela real)
        self.rpc_calls = []     # [(nome, args)] -- para os testes de concorrência/contagem
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            row = self.rows.get(key)
            return dict(row) if row else None

    def list(self, pool_id):
        with self._lock:
            return [dict(r) for r in self.rows.values() if r["pool_id"] == pool_id]

    def save_row(self, args):
        key = args["p_idempotency_key"]
        recipients = args.get("p_recipients") or []
        for r in recipients:
            if "@" in (r.get("entryRef") or ""):
                raise RuntimeError(
                    "upsert_bolao_notif_round_job: entryRef nao pode ser um endereco de e-mail")
        with self._lock:
            existing = self.rows.get(key)
            row = {
                "idempotency_key": key,
                "pool_id": args["p_pool_id"],
                "round_number": args["p_round_number"],
                "state": args.get("p_state") or "READY",
                "content_hash": args["p_content_hash"],
                "recipient_set_hash": args["p_recipient_set_hash"],
                "fixture_set_hash": args["p_fixture_set_hash"],
                "expected_recipient_count": args.get("p_expected_recipient_count") or 0,
                "resolved_recipient_count": args.get("p_resolved_recipient_count") or 0,
                "recipients": recipients,
                "attempt_count": args.get("p_attempt_count") or 0,
                "claimed_by": args.get("p_claimed_by"),
                "lease_until": args.get("p_lease_until"),
                "sent_at": args.get("p_sent_at"),
                "created_at": (existing or {}).get("created_at") or _iso(_now()),
                "updated_at": _iso(_now()),
            }
            self.rows[key] = row
            return dict(row)

    def claim(self, args):
        key = args["p_idempotency_key"]
        with self._lock:
            row = self.rows.get(key)
            if row is None or row["state"] not in CLAIMABLE_STATES:
                return None
            lease_until = row.get("lease_until")
            if lease_until and _parse(lease_until) > _now():
                return None
            lease_seconds = max(30, args.get("p_lease_seconds") or 300)
            row["state"] = "CLAIMED"
            row["claimed_by"] = args["p_owner"]
            row["lease_until"] = _iso(_now() + timedelta(seconds=lease_seconds))
            row["updated_at"] = _iso(_now())
            return dict(row)


def make_round_rpc_caller(store):
    """(name, args) -> resultado. Assinatura exigida por `S._ROUND_RPC_CALLER`."""
    def caller(name, args):
        store.rpc_calls.append((name, args))
        if name == "get_bolao_notif_round_job":
            return store.get(args["p_idempotency_key"])
        if name == "list_bolao_notif_round_jobs":
            return store.list(args["p_pool_id"])
        if name == "upsert_bolao_notif_round_job":
            return store.save_row(args)
        if name == "claim_bolao_notif_round_job":
            return store.claim(args)
        raise ValueError(f"RPC desconhecida no dublê: {name}")
    return caller
