#!/usr/bin/env python3
"""
Ação ÚNICA de operador (2026-08-26): corrige `updatedAt` da entrada do Gabriel Ferrari para
refletir QUANDO ele de fato tentou salvar (25/08 08:30 ET = 2026-08-25T12:30:00Z), não quando a
entrada manual foi gravada por mim (26/08). Autorizado explicitamente pelo Eduardo.

Só toca esse UM campo dessa UMA entrada. Mesma guarda de fingerprint das outras entradas do
`fix_gabriel_quartas_picks_20260826.py` — aborta se qualquer outra entrada mudar durante a
escrita.

Uso:
    python3 backdate_gabriel_updated_at_20260826.py --dry-run
    python3 backdate_gabriel_updated_at_20260826.py --apply
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.request

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
GABRIEL_ID = "2a0eb9e8-7210-4645-aa45-016f7abfa776"
NOVO_UPDATED_AT = "2026-08-25T12:30:00Z"   # 25/08 08:30 ET (EDT, UTC-4)


def _key():
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente.")
        sys.exit(2)
    return k


def _req(metodo, caminho, corpo=None):
    k = _key()
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    if corpo is not None:
        h["Prefer"] = "return=minimal"
    dados = json.dumps(corpo).encode() if corpo is not None else None
    r = urllib.request.Request(f"{SUPABASE}{caminho}", data=dados, headers=h, method=metodo)
    with urllib.request.urlopen(r, timeout=30) as resp:
        txt = resp.read().decode()
        return resp.status, (json.loads(txt) if txt.strip() else None)


def le_estado():
    _, d = _req("GET", "/rest/v1/bolao_state?id=eq.cdb2026&select=state")
    if not d:
        print("🛑 estado do cdb2026 inexistente.")
        sys.exit(2)
    return d[0]["state"]


def fingerprint_outras_entradas(entries, exceto_id):
    corpo = sorted(
        (e["id"], hashlib.sha256(json.dumps(e, sort_keys=True, ensure_ascii=False).encode()).hexdigest())
        for e in entries if e.get("id") != exceto_id
    )
    return hashlib.sha256(json.dumps(corpo).encode()).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if not args.dry_run and not args.apply:
        print("uso: --dry-run ou --apply")
        return 2

    estado = le_estado()
    entries = estado.get("entries") or []
    gab_idx = next((i for i, e in enumerate(entries) if e.get("id") == GABRIEL_ID), None)
    if gab_idx is None:
        print("🛑 entrada do Gabriel não encontrada.")
        return 2
    gab = entries[gab_idx]

    tem_quartas = "espn-atletico-mg_cruzeiro" in (gab["picks"].get("matches") or {})
    print("=" * 70)
    print("  CDB2026 — corrigir updatedAt do Gabriel Ferrari")
    print("=" * 70)
    print(f"  updatedAt atual   = {gab.get('updatedAt')}")
    print(f"  updatedAt novo    = {NOVO_UPDATED_AT}")
    print(f"  tem picks quartas = {tem_quartas}  (esperado: True)")

    if not tem_quartas:
        print("🛑 entrada sem picks de quartas ainda — algo mudou desde o fix anterior. ABORTANDO.")
        return 1

    if args.dry_run:
        print("\n  DRY RUN — nada gravado.")
        print("=" * 70)
        return 0

    fp_antes = fingerprint_outras_entradas(entries, GABRIEL_ID)

    novo_gab = dict(gab)
    novo_gab["updatedAt"] = NOVO_UPDATED_AT
    entries[gab_idx] = novo_gab
    estado["entries"] = entries
    _req("PATCH", "/rest/v1/bolao_state?id=eq.cdb2026", {"state": estado})

    depois = le_estado()
    entries_depois = depois.get("entries") or []
    fp_depois = fingerprint_outras_entradas(entries_depois, GABRIEL_ID)
    gab_depois = next((e for e in entries_depois if e.get("id") == GABRIEL_ID), None)

    print("\n  VERIFICAÇÃO PÓS-ESCRITA")
    print(f"  fingerprint outras entradas antes  = {fp_antes}")
    print(f"  fingerprint outras entradas depois = {fp_depois}")
    print(f"  outras entradas intocadas?         = {fp_antes == fp_depois}")
    print(f"  Gabriel.updatedAt gravado          = {gab_depois.get('updatedAt') if gab_depois else '(sumiu!)'}")

    if fp_antes != fp_depois:
        print("\n  🛑 FINGERPRINT DIVERGIU — outra entrada mudou durante a escrita. INVESTIGAR.")
        print("=" * 70)
        return 2
    if not gab_depois or gab_depois.get("updatedAt") != NOVO_UPDATED_AT:
        print("\n  🛑 updatedAt não gravado corretamente.")
        print("=" * 70)
        return 2

    print("\n  ✓ GRAVADO.")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
