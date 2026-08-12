#!/usr/bin/env python3
"""M8/M9 — matriz de queda e forja, medida contra a PRODUÇÃO.

O QUE ESTE TESTE DEFENDE
-----------------------
O outbox existe para eliminar UM modo de falha: estado de negócio mudou, processo caiu, a
obrigação de notificar sumiu com ele. Isso só se prova quebrando de propósito em cada ponto do
caminho e verificando que a obrigação sobrevive — e, do outro lado, que ela não é cumprida duas
vezes.

A propriedade central, da qual as outras são consequência:

    NENHUM DESTINATÁRIO ACEITO RECEBE DE NOVO.

Um evento aceito é terminal. Um evento com lease vencido volta. Um evento liquidado duas vezes é
recusado. Dois consumidores simultâneos pegam coisas diferentes.

SEGURANÇA (§12/§13)
-------------------
As tabelas vivem em schemas não expostos ao PostgREST (medido: 406 "Invalid schema"), mas a ponte
`public.emit_*` É exposta — funções SECURITY DEFINER em `public` são chamáveis por qualquer
portador da chave publicável. O REVOKE é a única coisa entre a ponte e um endpoint público de
forja de auditoria. Aqui isso é atacado com a chave anon REAL, não presumido.

CUSTO EM PRODUÇÃO
-----------------
Eventos de outbox usam o prefixo `canary:` e são removidos por `purge_canary_outbox_events()`, que
só sabe apagar esse prefixo. Eventos de AUDITORIA não são removíveis — a tabela é append-only por
trigger, de propósito. Este teste emite UM evento de auditoria por execução, marcado
`source=canary`. Isso é honesto: o canário rodou, e a auditoria dizer que ele rodou é o
comportamento correto de um log append-only, não poluição.

Uso (só no ambiente confiável): python3 bolao/scripts/test_m8m9_integration.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"

ok = 0
fail = 0


def check(nome, cond, detalhe=""):
    global ok, fail
    if cond:
        print(f"  ✓ {nome}")
        ok += 1
    else:
        print(f"  ✗ {nome}" + (f"\n      {detalhe}" if detalhe else ""))
        fail += 1


def _key(privilegiada):
    if privilegiada:
        k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        if not k:
            print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — só roda no ambiente confiável.")
            sys.exit(2)
        return k
    return ANON


def rpc(nome, args, privilegiada=True):
    k = _key(privilegiada)
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    r = urllib.request.Request(f"{SUPABASE}/rest/v1/rpc/{nome}",
                              data=json.dumps(args).encode(), headers=h, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt.strip() else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {"raw": txt[:200]}
    except Exception as e:
        return 0, {"raw": f"{type(e).__name__}: {e}"}


def status_de(chave):
    st, r = rpc("outbox_event_status", {"p_idempotency_key": chave})
    if st == 200 and r:
        return r[0]
    return None


def main():
    print("=" * 78)
    print("  M8/M9 — MATRIZ DE QUEDA E FORJA (produção)")
    print("=" * 78)
    corr = str(uuid.uuid4())
    marca = uuid.uuid4().hex[:8]

    # ══ §13 SEGURANÇA: a anon não pode nada ═════════════════════════════════════════════════
    print("\n── anon contra a ponte (tem de ser NEGADA em todas) ──")
    ataques = [
        ("emitir auditoria", "emit_audit_event",
         {"p_action": "forjado.evento", "p_aggregate_type": "pool"}),
        ("emitir notificação", "emit_outbox_event",
         {"p_idempotency_key": f"anon:forja:{marca}", "p_event_type": "forjado.evento",
          "p_payload": {}}),
        ("reivindicar evento", "claim_outbox_event", {"p_lease_owner": "atacante"}),
        ("liquidar evento", "settle_outbox_event",
         {"p_outbox_event_id": str(uuid.uuid4()), "p_outcome": "success"}),
        ("recuperar leases", "recover_expired_outbox_leases", {}),
        ("ler estado", "outbox_event_status", {"p_idempotency_key": "x"}),
        ("purgar canários", "purge_canary_outbox_events", {}),
    ]
    permitidos = []
    for rotulo, fn, args in ataques:
        st, r = rpc(fn, args, privilegiada=False)
        negado = st in (401, 403, 404)
        check(f"anon NÃO consegue {rotulo}", negado, f"http={st} {json.dumps(r or {})[:90]}")
        if not negado:
            permitidos.append(rotulo)

    # ══ §12 AUDITORIA ═══════════════════════════════════════════════════════════════════════
    print("\n── auditoria (M8) ──")
    st, r = rpc("emit_audit_event", {
        "p_action": "canary.integration_run", "p_aggregate_type": "platform",
        "p_aggregate_key": f"canary:{marca}", "p_source": "canary",
        "p_safe_metadata": {"marca": marca}, "p_correlation_id": corr,
        "p_reason": "matriz de queda M8/M9"})
    check("service_role emite evento de auditoria", st == 200 and r, f"http={st} {r}")

    st, r = rpc("emit_audit_event", {"p_action": "FORMATO ERRADO", "p_aggregate_type": "pool"})
    check("ação fora do formato é RECUSADA (não vira CHECK cru)",
          st >= 400 and "ACAO_INVALIDA" in json.dumps(r or {}), f"http={st} {r}")

    # ══ §11 MATRIZ DE QUEDA ═════════════════════════════════════════════════════════════════
    print("\n── produtor: idempotência ──")
    chave = f"canary:crash-matrix:{marca}:v1"
    st, r1 = rpc("emit_outbox_event", {
        "p_idempotency_key": chave, "p_event_type": "canary.probe",
        "p_payload": {"marca": marca}, "p_correlation_id": corr})
    check("primeira produção CRIA o evento",
          st == 200 and r1 and r1[0]["created"] is True, f"http={st} {r1}")
    id1 = r1[0]["outbox_event_id"] if r1 else None

    st, r2 = rpc("emit_outbox_event", {
        "p_idempotency_key": chave, "p_event_type": "canary.probe",
        "p_payload": {"marca": "DIFERENTE"}, "p_correlation_id": corr})
    check("produtor chamado DE NOVO não cria segundo evento",
          st == 200 and r2 and r2[0]["created"] is False and r2[0]["outbox_event_id"] == id1,
          f"http={st} {r2}")

    print("\n── consumidor: reivindicação e concorrência ──")
    st, c1 = rpc("claim_outbox_event", {"p_lease_owner": f"worker-A-{marca}",
                                        "p_lease_seconds": 300, "p_event_type": "canary.probe"})
    check("consumidor reivindica o evento", st == 200 and c1 and c1[0]["outbox_event_id"] == id1,
          f"http={st} {c1}")
    check("evento reivindicado fica in_flight", (status_de(chave) or {}).get("status") == "in_flight",
          f"estado={status_de(chave)}")

    st, c2 = rpc("claim_outbox_event", {"p_lease_owner": f"worker-B-{marca}",
                                        "p_lease_seconds": 300, "p_event_type": "canary.probe"})
    check("SEGUNDO consumidor NÃO pega o mesmo evento (skip locked)",
          st == 200 and not c2, f"pegou {c2} — dois workers enviariam a mesma coisa")

    print("\n── queda depois de reivindicar: lease vencido ──")
    # Lease de 1s: simula worker que morreu entre reivindicar e liquidar.
    chave2 = f"canary:lease:{marca}:v1"
    rpc("emit_outbox_event", {"p_idempotency_key": chave2, "p_event_type": "canary.lease",
                              "p_payload": {}, "p_correlation_id": corr})
    rpc("claim_outbox_event", {"p_lease_owner": "worker-morto", "p_lease_seconds": 1,
                               "p_event_type": "canary.lease"})
    time.sleep(2.5)
    st, n = rpc("recover_expired_outbox_leases", {})
    check("lease vencido é recuperado", st == 200 and isinstance(n, int) and n >= 1, f"n={n}")
    check("evento recuperado volta a pending",
          (status_de(chave2) or {}).get("status") == "pending", f"estado={status_de(chave2)}")

    print("\n── liquidação ──")
    st, novo = rpc("settle_outbox_event", {"p_outbox_event_id": id1, "p_outcome": "success",
                                           "p_provider_message_id": f"canary-{marca}"})
    check("sucesso leva a sent", st == 200 and novo == "sent", f"http={st} {novo}")

    st, r = rpc("settle_outbox_event", {"p_outbox_event_id": id1, "p_outcome": "success"})
    check("liquidar DE NOVO é recusado (aceito é terminal)",
          st >= 400 and "TRANSICAO_ILEGAL" in json.dumps(r or {}), f"http={st} {r}")

    st, c3 = rpc("claim_outbox_event", {"p_lease_owner": "worker-C", "p_event_type": "canary.probe"})
    check("evento SENT nunca mais é reivindicado (não reenvia)", st == 200 and not c3, f"{c3}")

    print("\n── falha transitória, backoff e morte por esgotamento ──")
    chave3 = f"canary:retry:{marca}:v1"
    st, r3 = rpc("emit_outbox_event", {"p_idempotency_key": chave3, "p_event_type": "canary.retry",
                                       "p_payload": {}, "p_correlation_id": corr})
    id3 = r3[0]["outbox_event_id"]
    rpc("claim_outbox_event", {"p_lease_owner": "w", "p_event_type": "canary.retry"})
    st, novo = rpc("settle_outbox_event", {"p_outbox_event_id": id3,
                                           "p_outcome": "transient_failure",
                                           "p_failure_category": "canary"})
    check("falha transitória volta a pending", st == 200 and novo == "pending", f"{novo}")
    e = status_de(chave3) or {}
    check("attempt_count avançou", e.get("attempt_count") == 1, f"{e}")

    # ── O BACKOFF PRECISA DE MARGEM MAIOR QUE A LATENCIA DA REDE ────────────────────────────
    #
    # A versao anterior media logo apos a PRIMEIRA falha, quando o backoff e min(2^1,3600) = 2s.
    # Entre `settle` e `claim` ha duas viagens ate o Supabase; quando passavam de 2s, a
    # reivindicacao voltava a ser legitima e o teste acusava ausencia de backoff que existia.
    #
    # Falso alarme sobre uma protecao que funciona custa mais caro que nao testar: ensina a
    # ignorar o alarme. Entao o caso caminha ate a terceira tentativa, onde o backoff e 8s --
    # folga suficiente para a latencia nao decidir o resultado.
    for _ in range(2):
        time.sleep(min(2 ** (status_de(chave3) or {}).get("attempt_count", 1), 3600) + 0.6)
        st, c = rpc("claim_outbox_event", {"p_lease_owner": "w", "p_event_type": "canary.retry"})
        if not c:
            break
        rpc("settle_outbox_event", {"p_outbox_event_id": id3, "p_outcome": "transient_failure"})

    e = status_de(chave3) or {}
    st, r = rpc("claim_outbox_event", {"p_lease_owner": "w", "p_event_type": "canary.retry"})
    check(f"backoff de {2 ** e.get('attempt_count', 1)}s impede reivindicação imediata",
          st == 200 and not r,
          f"pegou {r} com attempt_count={e.get('attempt_count')} — sem backoff um destino que "
          "falha vira laço apertado")

    # ── Esgotamento das tentativas ──────────────────────────────────────────────────────────
    #
    # A primeira versão deste bloco reivindicava em laço apertado e chamava
    # `recover_expired_outbox_leases()` para "devolver sem esperar". Não funciona, e a razão
    # importa: recuperar lease conserta um WORKER QUE MORREU (in_flight preso); backoff é outra
    # coisa — é o evento em `pending` com `next_attempt_at` no futuro. Nenhuma das duas substitui
    # a outra, e confundi-las fez o laço nunca passar da segunda tentativa.
    #
    # Então o teste espera o backoff de verdade. Fica lento (~62s: 2+4+8+16+32), e em troca prova
    # o cronograma além da contagem — se a fórmula mudar, os prazos abaixo deixam de bater.
    chave4 = f"canary:esgota:{marca}:v1"
    st, r4 = rpc("emit_outbox_event", {"p_idempotency_key": chave4, "p_event_type": "canary.esgota",
                                       "p_payload": {}, "p_correlation_id": corr})
    id4 = r4[0]["outbox_event_id"]
    backoff_respeitado = True
    for tentativa in range(1, 7):
        st, c = rpc("claim_outbox_event", {"p_lease_owner": "w", "p_event_type": "canary.esgota"})
        if not c:
            backoff_respeitado = False
            break
        st, novo = rpc("settle_outbox_event", {"p_outbox_event_id": id4,
                                               "p_outcome": "transient_failure"})
        if novo != "pending":
            break
        # min(2^tentativa, 3600) + margem para o relógio do servidor
        time.sleep(min(2 ** tentativa, 3600) + 0.6)

    e = status_de(chave4) or {}
    check("cada tentativa foi reivindicável após o backoff", backoff_respeitado,
          "uma reivindicação falhou antes do esgotamento — backoff ou contagem divergiu")
    check("esgotar as 6 tentativas leva a dead", e.get("status") == "dead", f"{e}")
    check("dead carrega dead_at (CHECK oe_dead_has_timestamp)", bool(e.get("dead_at")), f"{e}")
    check("attempt_count parou em MAX_ATTEMPTS", e.get("attempt_count") == 6, f"{e}")

    print("\n── falha permanente ──")
    chave5 = f"canary:permanente:{marca}:v1"
    st, r5 = rpc("emit_outbox_event", {"p_idempotency_key": chave5, "p_event_type": "canary.perm",
                                       "p_payload": {}, "p_correlation_id": corr})
    id5 = r5[0]["outbox_event_id"]
    rpc("claim_outbox_event", {"p_lease_owner": "w", "p_event_type": "canary.perm"})
    st, novo = rpc("settle_outbox_event", {"p_outbox_event_id": id5,
                                           "p_outcome": "permanent_failure",
                                           "p_failure_category": "canary"})
    check("falha permanente vai direto a dead (não repete)", st == 200 and novo == "dead", f"{novo}")

    st, r = rpc("settle_outbox_event", {"p_outbox_event_id": str(uuid.uuid4()),
                                        "p_outcome": "success"})
    check("liquidar evento inexistente é erro explícito",
          st >= 400 and "EVENTO_INEXISTENTE" in json.dumps(r or {}), f"http={st} {r}")

    st, r = rpc("settle_outbox_event", {"p_outbox_event_id": id5, "p_outcome": "desfecho_inventado"})
    check("desfecho inválido é recusado", st >= 400, f"http={st} {r}")

    # ══ limpeza ═════════════════════════════════════════════════════════════════════════════
    print("\n── limpeza ──")
    st, n = rpc("purge_canary_outbox_events", {})
    check("eventos de canário removidos da fila real", st == 200 and isinstance(n, int) and n >= 4,
          f"n={n}")
    check("nada de canário sobrou", status_de(chave) is None and status_de(chave5) is None)

    print(f"\n  {ok} passed, {fail} failed")
    print(f"  ANON_ALLOWED_OPERATIONS   = {len(permitidos)} {permitidos}")
    print(f"  NO_DUPLICATE_ACCEPTED     = {'PASS' if fail == 0 else 'CHECK'}")
    print("  M8M9_INTEGRATION = " + ("PASS" if fail == 0 else "FAIL"))
    print("=" * 78)
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
