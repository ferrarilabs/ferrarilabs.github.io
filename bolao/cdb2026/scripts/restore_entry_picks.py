#!/usr/bin/env python3
"""CDB2026 — restaura os palpites de UMA entrada a partir de um backup verificado.

POR QUE ISTO EXISTIU
--------------------
2026-08-12: o canário de acesso seguro gravava um valor sintético para provar que a escrita
existia. Enquanto a fase estava FECHADA a escrita era recusada, e o canário só media a recusa. No
minuto em que a tabela oficial materializou e os palpites abriram, a mesma linha passou a ser
ACEITA e substituiu os palpites reais de um participante — 8 `matches` e 8 `qualified` viraram
uma chave de teste.

O canário já foi corrigido para salvar de volta o que leu. Este script conserta o dano.

COMO
----
Pelo mesmo caminho do participante (`cdb_save_my_picks`), não por escrita de documento inteiro:
emite credencial, grava, revoga. O servidor valida prazo e identidade exatamente como faria para
a pessoa. Restaurar por um caminho privilegiado que ninguém mais usa seria consertar o dado e
deixar de exercitar a única via que precisa estar correta.

A entrada e o conteúdo vêm de ARGUMENTOS, e o conteúdo tem de vir de um backup — este script não
adivinha palpite de ninguém.

Uso (ambiente confiável):
    python3 bolao/cdb2026/scripts/restore_entry_picks.py --entry-id <uuid> --picks-file <json> [--apply]
"""
import argparse
import hashlib
import json
import os
import secrets
import sys
import urllib.error
import urllib.request

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"


def _key(privilegiada=False):
    if privilegiada:
        k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        if not k:
            print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — só roda no ambiente confiável.")
            sys.exit(2)
        return k
    return ANON


def req(metodo, caminho, corpo=None, privilegiada=False, extra=None):
    k = _key(privilegiada)
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    h.update(extra or {})
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
            return e.code, {"raw": txt[:200]}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--entry-id", required=True)
    p.add_argument("--picks-file", required=True)
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()

    alvo = json.load(open(args.picks_file))
    if not isinstance(alvo, dict) or not alvo:
        print("🛑 arquivo de palpites vazio ou malformado — não restauro o que não sei.")
        return 2

    print("=" * 70)
    print("  CDB2026 — RESTAURAÇÃO DE PALPITES")
    print("=" * 70)
    print(f"  entrada        {args.entry_id[:8]}…")
    print(f"  a restaurar    matches={len(alvo.get('matches') or {})} "
          f"qualified={len(alvo.get('qualified') or {})}")

    st, dados = req("GET", "/rest/v1/bolao_state?id=eq.cdb2026&select=state", privilegiada=True)
    if st != 200 or not dados:
        print(f"🛑 leitura do estado falhou: http={st}")
        return 2
    entradas = dados[0]["state"].get("entries") or []
    atual = next((e for e in entradas if e.get("id") == args.entry_id), None)
    if atual is None:
        print("🛑 entrada não encontrada no estado atual.")
        return 2
    pk = atual.get("picks") or {}
    print(f"  estado atual   chaves={list(pk.keys())} "
          f"matches={len(pk.get('matches') or {})} qualified={len(pk.get('qualified') or {})}")

    if pk == alvo:
        print("\n  ✓ já está idêntico ao backup — nada a fazer (idempotente)")
        print("  RESTORE_STATUS = ALREADY_CORRECT")
        return 0

    if not args.apply:
        print("\n  DRY-RUN — nada gravado. Use --apply.")
        print("  RESTORE_STATUS = DRY_RUN")
        return 0

    # Caminho do PARTICIPANTE: emite, usa, revoga.
    token = secrets.token_urlsafe(32)
    st, _ = req("POST", "/rest/v1/cdb_entry_access",
                {"entry_id": args.entry_id,
                 "token_hash": hashlib.sha256(token.encode()).hexdigest(),
                 "revoked_at": None, "note": "restauracao de palpites; revogado no fim"},
                privilegiada=True,
                extra={"Prefer": "resolution=merge-duplicates,return=minimal"})
    if st not in (200, 201, 204):
        print(f"🛑 emissão de credencial falhou: http={st}")
        return 2
    try:
        st, r = req("POST", "/rest/v1/rpc/cdb_save_my_picks",
                    {"p_token": token, "p_client_ref": "restore", "p_picks": alvo})
        if not (200 <= st < 300):
            print(f"🛑 gravação recusada: http={st} {json.dumps(r or {})[:160]}")
            return 1
    finally:
        req("PATCH", f"/rest/v1/cdb_entry_access?entry_id=eq.{args.entry_id}",
            {"revoked_at": "now()"}, privilegiada=True, extra={"Prefer": "return=minimal"})

    st, dados = req("GET", "/rest/v1/bolao_state?id=eq.cdb2026&select=state", privilegiada=True)
    depois = next((e for e in (dados[0]["state"].get("entries") or [])
                   if e.get("id") == args.entry_id), {}).get("picks") or {}
    ok = depois == alvo
    print(f"\n  verificação    matches={len(depois.get('matches') or {})} "
          f"qualified={len(depois.get('qualified') or {})}")
    print("  RESTORE_STATUS = " + ("RESTORED" if ok else "MISMATCH"))
    print("=" * 70)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
