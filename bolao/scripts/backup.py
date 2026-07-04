#!/usr/bin/env python3
"""
backup.py — Snapshot completo: código (git tag) + dados (Supabase → JSON local).

Uso:
  python3 bolao/scripts/backup.py                 # tag automática com timestamp
  python3 bolao/scripts/backup.py --label pre-r16 # tag com label personalizada
  python3 bolao/scripts/backup.py --data-only     # só dados, sem git tag
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

# ── Config (lido de js/config.js via grep, sem import JS) ─────────────────────
SUPABASE_URL  = "https://cmhqkkfczotdnssupkni.supabase.co"
SUPABASE_ANON = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
TABLE         = "bolao_state"
STATE_ID      = "main"

BACKUP_DIR = os.path.join(os.path.dirname(__file__), "..", "backups")


def fetch_supabase_state():
    url = f"{SUPABASE_URL}/rest/v1/{TABLE}?id=eq.{STATE_ID}&select=*"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_ANON,
        "Authorization": f"Bearer {SUPABASE_ANON}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            rows = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"  ✗ Supabase HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  ✗ Supabase fetch falhou: {e}", file=sys.stderr)
        return None
    if not rows:
        print("  ✗ Nenhuma linha retornada do Supabase.", file=sys.stderr)
        return None
    return rows[0].get("state")


def git_tag(label):
    """Creates annotated git tag; returns tag name or None on error."""
    try:
        sha = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], text=True
        ).strip()
        tag = f"backup-{label}-{sha}"
        subprocess.check_call(
            ["git", "tag", "-a", tag, "-m", f"Backup: {label} @ {sha}"]
        )
        subprocess.check_call(["git", "push", "origin", tag])
        return tag
    except subprocess.CalledProcessError as e:
        print(f"  ✗ git tag falhou: {e}", file=sys.stderr)
        return None


def save_backup(state, label):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"backup-{label}-{ts}.json"
    path = os.path.join(BACKUP_DIR, filename)
    payload = {
        "backupLabel": label,
        "backupAt": datetime.now(timezone.utc).isoformat(),
        "source": "supabase",
        "state": state,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return path


def summarize(state):
    if not state:
        return "  (estado vazio)"
    entries  = state.get("entries", [])
    paid     = state.get("paid", {})
    results  = state.get("results", {})
    n_paid   = sum(1 for v in paid.values() if v)
    n_res    = sum(1 for v in results.values() if v.get("advanceSide"))
    return (f"  {len(entries)} entrada(s) · {n_paid} pago(s) · "
            f"{n_res} resultado(s) knockout confirmado(s)")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--label", default="")
    p.add_argument("--data-only", action="store_true")
    args = p.parse_args()

    ts_label = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    label = (args.label + "-" + ts_label) if args.label else ts_label

    print(f"\n=== Backup Bolão — {label} ===\n")

    # 1. Dados Supabase
    print("1. Buscando estado do Supabase…")
    state = fetch_supabase_state()
    if state is None:
        print("  AVISO: backup de dados não foi possível. Continuando com tag de código apenas.")
    else:
        path = save_backup(state, label)
        print(f"  ✓ Salvo em: {path}")
        print(summarize(state))

    # 2. Git tag (código)
    if not args.data_only:
        print("\n2. Criando git tag…")
        tag = git_tag(label)
        if tag:
            print(f"  ✓ Tag criada e enviada: {tag}")
        else:
            print("  AVISO: tag não criada.")

    print("\n✓ Backup concluído.\n")


if __name__ == "__main__":
    main()
