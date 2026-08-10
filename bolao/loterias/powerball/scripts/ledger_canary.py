"""
ledger_canary.py — prova, DE DENTRO DO RUNNER, que o ledger funciona com a credencial certa.

Existe porque nada disto pode ser provado da maquina de desenvolvimento: local eu tenho um
`supabase link` que o runner nao tem, e nao tenho a credencial privilegiada que o runner tem.
Foi exatamente essa assimetria que deixou o ledger inoperante em producao sem ninguem notar --
matriz de crash verde localmente, tres execucoes reais falhando.

O canario grava e apaga um job SINTETICO (`__canary__`), que nenhum app le. Nunca toca job de
competicao real: ja causei um incidente de producao nesta sessao sondando com uma chave que
existia de verdade.

NUNCA imprime a credencial. So presenca, comprimento zero/nao-zero e o desfecho das chamadas.

Uso:
  python3 ledger_canary.py              # antes da revogacao: mede os dois caminhos
  python3 ledger_canary.py --post-cutover   # depois: exige que anon esteja NEGADO
"""

import json
import os
import sys
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import powerball_notification as P

POOL = "__canary__"


def chamar(nome, args, chave):
    req = urllib.request.Request(
        f"{P.SUPABASE_URL}/rest/v1/rpc/{nome}", data=json.dumps(args).encode(), method="POST",
        headers={"apikey": chave, "Authorization": f"Bearer {chave}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            bruto = r.read()
            return True, (json.loads(bruto) if bruto else None), r.status
    except urllib.error.HTTPError as e:
        return False, None, e.code
    except Exception as e:
        return False, None, type(e).__name__


def main():
    pos_corte = "--post-cutover" in sys.argv
    chave_priv = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    anon = P.ANON_KEY
    ident = f"{POOL}:probe:{uuid.uuid4().hex[:12]}:v1"
    falhas = []

    # Presenca, jamais o valor.
    presente = bool(chave_priv)
    print(f"SERVICE_ROLE_SECRET_PRESENT = {'YES' if presente else 'NO'}")
    if not presente:
        print("🛑 credencial privilegiada ausente no ambiente")
        return 1
    # Sanidade estrutural sem revelar nada: um JWT tem 3 partes.
    print(f"  formato: {'JWT (3 partes)' if chave_priv.count('.') == 2 else 'opaco'}"
          f", comprimento nao-zero: {len(chave_priv) > 0}")

    # ── caminho privilegiado ──────────────────────────────────────────────
    ok, _, st = chamar("enqueue_bolao_notif", {
        "p_pool_id": POOL, "p_entity_id": "canary", "p_event_type": "probe",
        "p_event_version": 1, "p_entry_ref": "AGGREGATE", "p_idempotency_key": ident,
        "p_payload": {"recipients": [{"entryRef": "ref-0", "state": "PENDING"}],
                      "contentHash": "canary"},
        "p_template_id": "t", "p_template_version": 1,
        "p_max_attempts": 1, "p_schema_version": 1}, chave_priv)
    print(f"LEDGER_RPC_FROM_RUNNER = {'PASS' if ok else 'FAIL'}  (enqueue http={st})")
    if not ok:
        falhas.append("enqueue privilegiado falhou")

    ok2, _, st2 = chamar("set_bolao_notif_recipient", {
        "p_idempotency_key": ident, "p_entry_ref": "ref-0", "p_state": "ACCEPTED"}, chave_priv)
    print(f"SERVICE_ROLE_LEDGER_WRITE = {'PASS' if ok2 else 'FAIL'}  (set_recipient http={st2})")
    if not ok2:
        falhas.append("escrita privilegiada falhou")

    ok3, r3, st3 = chamar("settle_bolao_notif", {"p_idempotency_key": ident}, chave_priv)
    estado = (r3[0]["status"] if isinstance(r3, list) and r3 else None)
    print(f"  settle privilegiado: {'PASS' if ok3 else 'FAIL'} (http={st3}, status={estado})")
    if not ok3:
        falhas.append("settle privilegiado falhou")

    # ── caminho anonimo ───────────────────────────────────────────────────
    ident_anon = f"{POOL}:anon:{uuid.uuid4().hex[:12]}:v1"
    anon_ok, _, anon_st = chamar("enqueue_bolao_notif", {
        "p_pool_id": POOL, "p_entity_id": "canary", "p_event_type": "probe",
        "p_event_version": 1, "p_entry_ref": "AGGREGATE", "p_idempotency_key": ident_anon,
        "p_payload": {}, "p_template_id": "t", "p_template_version": 1,
        "p_max_attempts": 1, "p_schema_version": 1}, anon)
    anon_mark, _, anon_mark_st = chamar(
        "mark_bolao_notif_sent", {"p_job_id": "00000000-0000-0000-0000-000000000000",
                                  "p_provider_message_id": "x"}, anon)

    if pos_corte:
        print(f"ANON_LEDGER_WRITE = {'DENIED' if not anon_ok else 'AINDA PERMITIDO'}"
              f"  (enqueue http={anon_st})")
        print(f"  anon mark_sent: {'DENIED' if not anon_mark else 'AINDA PERMITIDO'}"
              f" (http={anon_mark_st})")
        if anon_ok:
            falhas.append("anon ainda cria job apos a revogacao")
        if anon_mark:
            falhas.append("anon ainda chama mark_bolao_notif_sent apos a revogacao")
    else:
        print(f"ANON_LEDGER_WRITE_STILL_CURRENTLY_AVAILABLE = "
              f"{'YES' if anon_ok else 'NO'}  (enqueue http={anon_st})")
        print(f"  (esperado YES antes da migracao 021 — a revogacao ainda nao aconteceu)")

    # ── limpeza ───────────────────────────────────────────────────────────
    for k in (ident, ident_anon):
        chamar("delete_canary_job", {"p_idempotency_key": k}, chave_priv)

    print("PROVIDER_CALLS = 0  (o canario nao toca no provedor)")
    print("REAL_EMAILS_SENT = 0")
    if falhas:
        print("🛑 " + "; ".join(falhas))
        return 1
    print("✓ CANARIO OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
