#!/usr/bin/env python3
"""CDB2026 — quantas credenciais de acesso estao VIVAS (booleanos e contagens, nunca tokens).

POR QUE ISTO EXISTE
-------------------
Um convite entregue com link morto e pior que convite nao entregue: a pessoa tenta, nao entra, e
nao ha nada na tela que explique. O envio reporta sucesso -- o provedor de fato aceitou -- e o
defeito so aparece quando alguem clica.

Este verificador responde uma pergunta so: para cada entrada elegivel, existe credencial NAO
revogada? Nao imprime token, nao imprime e-mail, nao imprime hash.

Uso (ambiente confiavel): python3 bolao/cdb2026/scripts/check_access_credentials.py
"""
import json
import os
import sys
import urllib.error
import urllib.request

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"


def _key():
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — só roda no ambiente confiável.")
        sys.exit(2)
    return k


def req(caminho):
    k = _key()
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    r = urllib.request.Request(f"{SUPABASE}{caminho}", headers=h, method="GET")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, {"raw": e.read().decode()[:200]}


def main():
    print("=" * 70)
    print("  CDB2026 — CREDENCIAIS DE ACESSO (vivas x revogadas)")
    print("=" * 70)

    st, dados = req("/rest/v1/bolao_state?id=eq.cdb2026&select=state")
    if st != 200 or not dados:
        print(f"🛑 leitura do estado falhou: http={st}")
        return 2
    estado = dados[0]["state"]
    apagados = set(estado.get("deletedIds") or [])
    elegiveis = [e for e in (estado.get("entries") or [])
                 if e.get("id") not in apagados and (e.get("participantEmail") or "").strip()]

    st, linhas = req("/rest/v1/cdb_entry_access?select=entry_id,revoked_at")
    if st != 200:
        print(f"🛑 leitura de credenciais falhou: http={st}")
        return 2

    vivas = {l["entry_id"] for l in (linhas or []) if l.get("revoked_at") is None}
    revogadas = {l["entry_id"] for l in (linhas or []) if l.get("revoked_at") is not None}
    ids = {e["id"] for e in elegiveis}

    com_viva = ids & vivas
    so_revogada = (ids & revogadas) - vivas
    sem_nenhuma = ids - vivas - revogadas

    print(f"\n  entradas elegíveis          {len(ids)}")
    print(f"  com credencial VIVA         {len(com_viva)}")
    print(f"  APENAS revogada (link morto){len(so_revogada):>4}")
    print(f"  sem credencial nenhuma      {len(sem_nenhuma)}")

    print("\n" + "=" * 70)
    if so_revogada or sem_nenhuma:
        print(f"  LINKS_MORTOS = {len(so_revogada) + len(sem_nenhuma)}")
        print("  🛑 há convidados cujo link NÃO autentica.")
        print("=" * 70)
        return 1
    print("  LINKS_MORTOS = 0")
    print("  ✓ todo convidado tem credencial viva")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
