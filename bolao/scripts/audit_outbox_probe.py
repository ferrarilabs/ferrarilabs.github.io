#!/usr/bin/env python3
"""M8/M9 — o que a produção REALMENTE permite, medido, não suposto.

POR QUE ISTO EXISTE ANTES DA INTEGRAÇÃO
---------------------------------------
`audit.audit_events` e `bolao.outbox_events` foram criados com RLS ENABLED + FORCE e ZERO
policies, sem GRANT para anon nem authenticated, em schemas que não são o `public`. Cada uma
dessas três coisas basta sozinha para tornar a tabela inalcançável pelo PostgREST.

Escrever o integrador primeiro e descobrir isso na primeira execução seria repetir o erro que a
produção já me mostrou hoje de manhã: eu tinha assumido a forma de `phase.ties` e o script
anunciou "0 de 4 confrontos" contra um estado que tem 4. Aqui a ordem é inversa — medir, depois
escrever.

O que este probe decide:
  · o schema está exposto no PostgREST? (sem isso, nenhuma chave alcança a tabela por REST)
  · o service_role escreve? (é BYPASSRLS, mas GRANT e exposição são independentes de RLS)
  · a anon está negada em TUDO? (§12/§13: forjar auditoria e forjar notificação)

NÃO MUTA nada que fique: toda escrita de teste é revertida, e em `audit_events` — que é
append-only por trigger — o probe NÃO insere, apenas verifica a negação da anon.

Uso: python3 bolao/scripts/audit_outbox_probe.py
"""
import json
import os
import sys
import urllib.error
import urllib.request

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"

resultados = {}


def _key(privilegiada):
    if privilegiada:
        k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        if not k:
            print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — o probe só roda no ambiente confiável.")
            sys.exit(2)
        return k
    return ANON


def req(metodo, caminho, corpo=None, privilegiada=False, schema=None):
    """schema: usa Accept-Profile/Content-Profile, que é como o PostgREST alcança schema != public."""
    k = _key(privilegiada)
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    if schema:
        h["Accept-Profile"] = schema
        h["Content-Profile"] = schema
    dados = json.dumps(corpo).encode() if corpo is not None else None
    r = urllib.request.Request(f"{SUPABASE}{caminho}", data=dados, headers=h, method=metodo)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt.strip() else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {"raw": txt[:300]}
    except Exception as e:
        return 0, {"raw": f"{type(e).__name__}: {e}"}


def linha(rotulo, st, corpo):
    msg = ""
    if isinstance(corpo, dict):
        msg = corpo.get("message") or corpo.get("hint") or corpo.get("raw") or ""
    print(f"  {rotulo:<52} http={st:<4} {str(msg)[:70]}")
    return st


def main():
    print("=" * 84)
    print("  M8/M9 — ALCANCE REAL DO POSTGREST (medido em produção)")
    print("=" * 84)

    # ── O schema está exposto? ────────────────────────────────────────────────────────────
    print("\n── leitura com service_role (BYPASSRLS) ──")
    st_ob, c = req("GET", "/rest/v1/outbox_events?select=outbox_event_id&limit=1",
                   privilegiada=True, schema="bolao")
    resultados["outbox_read_service"] = linha("bolao.outbox_events SELECT (service_role)", st_ob, c)

    st_ae, c = req("GET", "/rest/v1/audit_events?select=audit_event_id&limit=1",
                   privilegiada=True, schema="audit")
    resultados["audit_read_service"] = linha("audit.audit_events SELECT (service_role)", st_ae, c)

    st_da, c = req("GET", "/rest/v1/outbox_delivery_attempts?select=outbox_delivery_attempt_id&limit=1",
                   privilegiada=True, schema="bolao")
    resultados["attempts_read_service"] = linha("bolao.outbox_delivery_attempts SELECT", st_da, c)

    # ── Sem o header de schema (prova que o profile é o que importa) ──────────────────────
    st, c = req("GET", "/rest/v1/outbox_events?select=outbox_event_id&limit=1", privilegiada=True)
    resultados["outbox_read_no_profile"] = linha("outbox_events SEM Accept-Profile", st, c)

    # ── Escrita com service_role ──────────────────────────────────────────────────────────
    print("\n── escrita com service_role ──")
    chave = "probe:reachability:v1"
    st_w, c = req("POST", "/rest/v1/outbox_events",
                  {"idempotency_key": chave, "channel": "email",
                   "event_type": "probe.reachability", "payload": {"probe": True}},
                  privilegiada=True, schema="bolao")
    resultados["outbox_insert_service"] = linha("bolao.outbox_events INSERT (service_role)", st_w, c)
    if st_w in (200, 201, 204):
        d, _ = req("DELETE", f"/rest/v1/outbox_events?idempotency_key=eq.{chave}",
                   privilegiada=True, schema="bolao")
        print(f"  {'(limpeza do probe)':<52} http={d}")

    # ── ANON: tem de estar negada em tudo (§12 e §13) ─────────────────────────────────────
    print("\n── anon: forja de auditoria e de notificação (tem de FALHAR) ──")
    ataques = [
        ("audit forjar INSERT", "POST", "/rest/v1/audit_events", "audit",
         {"action": "fake.event", "aggregate_type": "pool", "event_hash": "x"}),
        ("audit apagar", "DELETE", "/rest/v1/audit_events?action=eq.fake.event", "audit", None),
        ("audit alterar", "PATCH", "/rest/v1/audit_events?action=eq.fake.event", "audit",
         {"reason": "adulterado"}),
        ("audit ler", "GET", "/rest/v1/audit_events?select=audit_event_id&limit=1", "audit", None),
        ("outbox inserir notificação", "POST", "/rest/v1/outbox_events", "bolao",
         {"idempotency_key": "anon:forjado:v1", "channel": "email",
          "event_type": "forjado.evento", "payload": {}}),
        ("outbox marcar SENT", "PATCH", "/rest/v1/outbox_events?event_type=eq.probe.reachability",
         "bolao", {"status": "sent"}),
        ("outbox tomar lease", "PATCH", "/rest/v1/outbox_events?status=eq.pending", "bolao",
         {"status": "in_flight", "lease_owner": "atacante"}),
        ("outbox apagar", "DELETE", "/rest/v1/outbox_events?event_type=eq.probe.reachability",
         "bolao", None),
        ("outbox ler", "GET", "/rest/v1/outbox_events?select=outbox_event_id&limit=1", "bolao", None),
    ]
    anon_permitido = []
    for rotulo, metodo, caminho, schema, corpo in ataques:
        st, c = req(metodo, caminho, corpo, privilegiada=False, schema=schema)
        linha(f"anon: {rotulo}", st, c)
        # 2xx = passou. Qualquer 4xx = negado (401/403 sem permissão, 404 schema não exposto).
        if 200 <= st < 300:
            anon_permitido.append(rotulo)

    # ── Veredito ──────────────────────────────────────────────────────────────────────────
    print("\n" + "=" * 84)
    alcancavel_ob = resultados["outbox_read_service"] == 200
    alcancavel_ae = resultados["audit_read_service"] == 200
    escreve_ob = resultados["outbox_insert_service"] in (200, 201, 204)

    print(f"  OUTBOX_REST_REACHABLE_SERVICE = {'YES' if alcancavel_ob else 'NO'}")
    print(f"  OUTBOX_REST_WRITABLE_SERVICE  = {'YES' if escreve_ob else 'NO'}")
    print(f"  AUDIT_REST_REACHABLE_SERVICE  = {'YES' if alcancavel_ae else 'NO'}")
    print(f"  ANON_ALLOWED_OPERATIONS       = {len(anon_permitido)} {anon_permitido}")
    print("=" * 84)

    # A anon conseguir QUALQUER coisa é falha dura: é forja de auditoria ou de notificação.
    if anon_permitido:
        print("\n🛑 ANON CONSEGUIU OPERAR — forja possível. Isto é bloqueador.")
        return 1

    print("\n✓ anon negada em todas as operações de auditoria e outbox")
    # Alcance do service_role NÃO é falha: é o dado que decide a arquitetura da integração.
    # Schema não exposto no PostgREST é uma decisão legítima (e mais segura); só significa que o
    # produtor tem de escrever por outro caminho.
    return 0


if __name__ == "__main__":
    sys.exit(main())
