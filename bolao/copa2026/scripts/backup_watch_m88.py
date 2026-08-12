#!/usr/bin/env python3
"""
backup_watch_m88.py — Aguarda o resultado do M88 (Colombia vs Ghana) e faz
backup automático assim que o placar for confirmado no Supabase.

Uso:
  python3 bolao/scripts/backup_watch_m88.py

Fica em loop verificando a cada 60 s. Quando state.results["88"].advanceSide
aparecer, dispara backup.py --label post-m88 e encerra.
"""

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

SUPABASE_URL  = "https://cmhqkkfczotdnssupkni.supabase.co"
SUPABASE_ANON = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
# PRODMIG-Q38-READ: so precisa de `results`, e a projecao publica preserva `results`
# intacta (ela remove apenas PII de `entries`). Menor privilegio aqui e MENOS que
# service_role, nao mais: este leitor nao toca dado privado nenhum.
TABLE         = "bolao_state_public"
STATE_ID      = "main"
MATCH_ID      = "88"
POLL_INTERVAL = 60   # segundos entre verificações

SCRIPT_DIR = __file__.replace("backup_watch_m88.py", "backup.py")


def fetch_result_88():
    url = f"{SUPABASE_URL}/rest/v1/{TABLE}?id=eq.{STATE_ID}&select=state"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_ANON,
        "Authorization": f"Bearer {SUPABASE_ANON}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            rows = json.loads(r.read())
        if not rows:
            return None
        state = rows[0].get("state") or {}
        return state.get("results", {}).get(MATCH_ID)
    except Exception as e:
        print(f"  [aviso] Falha ao buscar Supabase: {e}")
        return None


def now_str():
    return datetime.now(timezone.utc).strftime("%H:%M:%SZ")


def main():
    print("\n=== Watcher M88 — aguardando resultado de Colombia vs Ghana ===")
    print(f"  Verificando a cada {POLL_INTERVAL}s. Ctrl+C para cancelar.\n")

    while True:
        result = fetch_result_88()
        if result and result.get("advanceSide"):
            adv  = result["advanceSide"]
            ga   = result.get("goalsA", "?")
            gb   = result.get("goalsB", "?")
            team = "Colombia" if adv == "A" else "Ghana"
            print(f"\n[{now_str()}] ✓ M88 encerrado: Colombia {ga}–{gb} Ghana → {team} avança")
            print("  Iniciando backup post-m88…\n")
            ret = subprocess.call([sys.executable, SCRIPT_DIR, "--label", "post-m88"])
            if ret == 0:
                print("\n✓ Backup post-m88 concluído. Watcher encerrado.")
            else:
                print("\n✗ Backup retornou erro. Rode manualmente:")
                print("  python3 bolao/scripts/backup.py --label post-m88")
            break
        else:
            print(f"[{now_str()}] M88 ainda sem resultado — próxima verificação em {POLL_INTERVAL}s…")
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nWatcher cancelado. Para backup manual:")
        print("  python3 bolao/scripts/backup.py --label post-m88")
