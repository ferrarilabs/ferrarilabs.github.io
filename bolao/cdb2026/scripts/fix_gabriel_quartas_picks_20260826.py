#!/usr/bin/env python3
"""
Ação ÚNICA de operador (2026-08-26): entra os palpites das quartas do Gabriel Ferrari
diretamente no documento — ele não conseguiu salvar pela via normal (site mostrando versão
antiga, e quando corrigido o prazo das quartas já tinha vencido de verdade). Autorizado
explicitamente pelo Eduardo, incluindo os 8 placares e a instrução de copiar o resto (quem
avança nas quartas + semifinal + final) da entrada do próprio Eduardo Ferrari.

NÃO toca em `cutoffAt` nem em `activePhase` — só a entrada do Gabriel muda. Preserva as picks de
oitavas dele (já salvas antes, intocadas). Escrita única, verificada antes e depois:

  1. lê o documento inteiro;
  2. confirma que a entrada do Gabriel ainda está do jeito que eu vi (updatedAt=None, sem
     picks de quartas) — se mudou, ABORTA em vez de sobrescrever;
  3. splica só `matches`+`qualified` novos na entrada dele, bump em `updatedAt`;
  4. escreve o documento inteiro de volta (mesmo padrão já usado para o Matheus em 2026-08);
  5. relê e confirma que NENHUMA outra entrada mudou (fingerprint antes/depois).

Uso:
    python3 fix_gabriel_quartas_picks_20260826.py --dry-run
    python3 fix_gabriel_quartas_picks_20260826.py --apply
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
GABRIEL_ID = "2a0eb9e8-7210-4645-aa45-016f7abfa776"
EDUARDO_ID = "03e9fe14-d777-4a71-9c31-3d54dd21a07c"

QUARTAS_MATCHES = {
    "espn-atletico-mg_cruzeiro": {"first": {"goalsHome": 2, "goalsAway": 2},
                                   "second": {"goalsHome": 1, "goalsAway": 1}},
    "espn-vasco_vitoria":        {"first": {"goalsHome": 3, "goalsAway": 0},
                                   "second": {"goalsHome": 2, "goalsAway": 1}},
    "espn-palmeiras_santos":     {"first": {"goalsHome": 3, "goalsAway": 1},
                                   "second": {"goalsHome": 1, "goalsAway": 1}},
    "espn-gremio_internacional": {"first": {"goalsHome": 2, "goalsAway": 1},
                                   "second": {"goalsHome": 2, "goalsAway": 1}},
}
COPY_FROM_EDUARDO_QUALIFIED = [
    "espn-atletico-mg_cruzeiro", "espn-vasco_vitoria", "espn-palmeiras_santos",
    "espn-gremio_internacional", "sf-1", "sf-2", "final-1",
]


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
    ed = next((e for e in entries if e.get("id") == EDUARDO_ID), None)
    if gab_idx is None or ed is None:
        print("🛑 entrada do Gabriel ou do Eduardo não encontrada.")
        return 2
    gab = entries[gab_idx]

    print("=" * 70)
    print("  CDB2026 — entrada manual de palpites (Gabriel Ferrari, quartas)")
    print("=" * 70)
    print(f"  Gabriel.updatedAt atual   = {gab.get('updatedAt')}")
    print(f"  Gabriel tem quartas?      = {any(t in (gab['picks'].get('matches') or {}) for t in QUARTAS_MATCHES)}")

    # GUARDA: se ele já tiver conseguido salvar quartas por outro caminho nesse meio tempo,
    # não sobrescrever — abortar e reportar, para reconferir manualmente.
    ja_tem_quartas = any(t in (gab["picks"].get("matches") or {}) for t in QUARTAS_MATCHES)
    if ja_tem_quartas:
        print("🛑 Gabriel já tem picks de quartas gravadas — ABORTANDO para não sobrescrever "
              "algo que pode ter sido salvo por outro caminho. Reconferir manualmente.")
        return 1

    fp_antes = fingerprint_outras_entradas(entries, GABRIEL_ID)

    novas_matches = dict(gab["picks"].get("matches") or {})
    novas_matches.update(QUARTAS_MATCHES)
    novo_qualified = dict(gab["picks"].get("qualified") or {})
    for k in COPY_FROM_EDUARDO_QUALIFIED:
        novo_qualified[k] = ed["picks"]["qualified"][k]

    agora = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    novo_gab = dict(gab)
    novo_gab["picks"] = {"matches": novas_matches, "qualified": novo_qualified}
    novo_gab["updatedAt"] = agora

    print(f"\n  novas picks de quartas (matches): {sorted(QUARTAS_MATCHES.keys())}")
    print(f"  qualified copiado do Eduardo: {COPY_FROM_EDUARDO_QUALIFIED}")
    print(f"  novo updatedAt: {agora}")

    if args.dry_run:
        print("\n  DRY RUN — nada gravado.")
        print("=" * 70)
        return 0

    entries[gab_idx] = novo_gab
    estado["entries"] = entries
    _req("PATCH", "/rest/v1/bolao_state?id=eq.cdb2026", {"state": estado, "updated_at": agora})

    depois = le_estado()
    entries_depois = depois.get("entries") or []
    fp_depois = fingerprint_outras_entradas(entries_depois, GABRIEL_ID)
    gab_depois = next((e for e in entries_depois if e.get("id") == GABRIEL_ID), None)

    print("\n  VERIFICAÇÃO PÓS-ESCRITA")
    print(f"  fingerprint outras entradas antes  = {fp_antes}")
    print(f"  fingerprint outras entradas depois = {fp_depois}")
    print(f"  outras entradas intocadas?         = {fp_antes == fp_depois}")
    print(f"  Gabriel.updatedAt gravado           = {gab_depois.get('updatedAt') if gab_depois else '(sumiu!)'}")
    quartas_ok = gab_depois and all(t in gab_depois["picks"]["matches"] for t in QUARTAS_MATCHES)
    print(f"  Gabriel tem os 4 confrontos agora?  = {quartas_ok}")

    if fp_antes != fp_depois:
        print("\n  🛑 FINGERPRINT DIVERGIU — outra entrada mudou durante a escrita. INVESTIGAR.")
        print("=" * 70)
        return 2
    if not quartas_ok:
        print("\n  🛑 palpites não gravados corretamente.")
        print("=" * 70)
        return 2

    print("\n  ✓ GRAVADO — só a entrada do Gabriel mudou.")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
