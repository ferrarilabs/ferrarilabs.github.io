#!/usr/bin/env python3
"""
backup_daily.py — Backup incremental diário do estado do Bolão.

Roda via cron a 01:00 AM EDT.  Só salva arquivo novo se o estado mudou
desde o último backup (hash SHA-256 do JSON).  Mantém os últimos 60 dias;
apaga os mais antigos automaticamente.

Uso manual:
  python3 bolao/scripts/backup_daily.py
  python3 bolao/scripts/backup_daily.py --force   # salva mesmo sem mudança
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

SUPABASE_URL  = "https://cmhqkkfczotdnssupkni.supabase.co"
SUPABASE_ANON = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
TABLE         = "bolao_state"
STATE_ID      = "main"

SCRIPT_DIR  = Path(__file__).parent
BACKUP_DIR  = SCRIPT_DIR.parent / "backups"
LOG_FILE    = BACKUP_DIR / "backup.log"
HASH_FILE   = BACKUP_DIR / ".last_hash"   # hash do último estado salvo
RETAIN_DAYS = 60


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def fetch_state():
    url = f"{SUPABASE_URL}/rest/v1/{TABLE}?id=eq.{STATE_ID}&select=state"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_ANON,
        "Authorization": f"Bearer {SUPABASE_ANON}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            rows = json.loads(r.read())
        if not rows:
            raise RuntimeError("Supabase retornou 0 linhas")
        return rows[0].get("state")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Supabase HTTP {e.code}: {e.read().decode()[:200]}")


def state_hash(state):
    canonical = json.dumps(state, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def load_last_hash():
    try:
        return HASH_FILE.read_text().strip()
    except FileNotFoundError:
        return None


def save_hash(h):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    HASH_FILE.write_text(h)


def save_backup(state, label="daily"):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"backup-{label}-{ts}.json"
    path = BACKUP_DIR / filename
    payload = {
        "backupLabel": label,
        "backupAt": datetime.now(timezone.utc).isoformat(),
        "source": "supabase",
        "state": state,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def summarize(state):
    entries = state.get("entries", [])
    paid    = state.get("paid", {})
    results = state.get("results", {})
    n_paid  = sum(1 for v in paid.values() if v)
    n_res   = sum(1 for v in results.values() if isinstance(v, dict) and v.get("advanceSide"))
    return f"{len(entries)} entrada(s), {n_paid} pago(s), {n_res} resultado(s) knockout"


def prune_old_backups():
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETAIN_DAYS)
    removed = 0
    for f in BACKUP_DIR.glob("backup-daily-*.json"):
        try:
            # filename format: backup-daily-YYYYMMDDTHHMMSSz.json
            ts_str = f.stem.split("-")[-1]            # e.g. 20260704T010000Z
            ts = datetime.strptime(ts_str, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            if ts < cutoff:
                f.unlink()
                removed += 1
        except Exception:
            pass
    if removed:
        log(f"  Limpeza: {removed} backup(s) com mais de {RETAIN_DAYS} dias removido(s)")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--force", action="store_true", help="Salva mesmo sem mudança")
    args = p.parse_args()

    log("=== Backup diário iniciado ===")

    # 1. Buscar estado atual
    try:
        state = fetch_state()
    except RuntimeError as e:
        log(f"ERRO ao buscar Supabase: {e}")
        sys.exit(1)

    if state is None:
        log("ERRO: estado retornado é null")
        sys.exit(1)

    # 2. Verificar se mudou desde o último backup
    current_hash = state_hash(state)
    last_hash    = load_last_hash()

    if not args.force and current_hash == last_hash:
        log(f"Sem mudanças desde o último backup ({summarize(state)}) — nenhum arquivo salvo")
        log("=== Backup diário concluído (sem alterações) ===\n")
        return

    # 3. Salvar
    path = save_backup(state, label="daily")
    save_hash(current_hash)
    log(f"✓ Salvo: {path.name}")
    log(f"  Estado: {summarize(state)}")

    # 4. Limpar backups antigos
    prune_old_backups()

    log("=== Backup diário concluído ===\n")


if __name__ == "__main__":
    main()
