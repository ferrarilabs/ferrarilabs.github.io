#!/usr/bin/env python3
"""
backup_daily.py — Backup incremental diário do estado do Bolão.

Cobre os três apps do bolão (mesma tabela Supabase, uma linha por app — ver
docs/bolao/DATABASE_SETUP_SUPABASE.md "Múltiplos apps na mesma tabela"): Copa do Mundo
2026 (id="main"), Brasileirão 2026 (id="br2026"), Copa do Brasil 2026 (id="cdb2026").
Extensão de 2026-07-16 (Eduardo: "the same way copa has, this also needs to have backups
done") — antes só cobria a Copa; o mesmo cron (01:00 AM EDT) agora cobre os três, sem
precisar de entradas de cron adicionais.

Roda via cron a 01:00 AM EDT.  Só salva arquivo novo (por app) se o estado daquele app
mudou desde o último backup (hash SHA-256 do JSON).  Mantém os últimos 60 dias por app;
apaga os mais antigos automaticamente.

Uso manual:
  python3 bolao/scripts/backup_daily.py
  python3 bolao/scripts/backup_daily.py --app cdb2026
  python3 bolao/scripts/backup_daily.py --force   # salva mesmo sem mudança
"""

import argparse
import hashlib
import os
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

SUPABASE_URL  = "https://cmhqkkfczotdnssupkni.supabase.co"
SUPABASE_ANON = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
TABLE         = "bolao_state"


# ── PRODMIG-Q38-READ ────────────────────────────────────────────────────────────────────────────
# Este leitor precisa do documento PRIVADO (e-mail, payerName, paymentTo), que a projecao publica
# `bolao_state_public` remove de proposito. Logo nao da para reaponta-lo para a view: ele passa a
# usar a credencial PRIVILEGIADA, do lado servidor.
#
# A chave vem SO do ambiente. Nao e impressa, nao entra em argv (visivel em `ps`), nao vai para
# arquivo nem para log. O unico sinal externo e a sua ausencia.
def _service_key():
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — leitura do documento privado exige runtime confiavel.")
        sys.exit(2)
    return k

APPS = [
    {"id": "main",    "label": "Copa do Mundo 2026"},
    {"id": "br2026",  "label": "Brasileirão 2026"},
    {"id": "cdb2026", "label": "Copa do Brasil 2026"},
]

SCRIPT_DIR  = Path(__file__).parent
BACKUP_DIR  = SCRIPT_DIR.parent / "backups"
LOG_FILE    = BACKUP_DIR / "backup.log"
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


ALLOWED_POOLS = {"main", "br2026", "cdb2026"}


def fetch_state(state_id):
    if state_id not in ALLOWED_POOLS:
        raise SystemExit(f"🛑 pool nao autorizado para backup: {state_id}")
    url = f"{SUPABASE_URL}/rest/v1/{TABLE}?id=eq.{state_id}&select=state"
    req = urllib.request.Request(url, headers={
        "apikey": _service_key(),
        "Authorization": f"Bearer {_service_key()}",
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


def hash_file(app_id):
    return BACKUP_DIR / f".last_hash_{app_id}"


def load_last_hash(app_id):
    try:
        return hash_file(app_id).read_text().strip()
    except FileNotFoundError:
        # Migração do formato antigo (pré-2026-07-16, um único .last_hash para a Copa) —
        # evita um backup "mudou" espúrio no primeiro run pós-deploy desta versão do script.
        if app_id == "main":
            try:
                return (BACKUP_DIR / ".last_hash").read_text().strip()
            except FileNotFoundError:
                return None
        return None


def save_hash(app_id, h):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    hash_file(app_id).write_text(h)


def save_backup(app_id, state, label="daily"):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"backup-{app_id}-{label}-{ts}.json"
    path = BACKUP_DIR / filename
    payload = {
        "app": app_id,
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
    n_paid  = sum(1 for v in paid.values() if v)
    return f"{len(entries)} entrada(s), {n_paid} pago(s)"


def prune_old_backups(app_id):
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETAIN_DAYS)
    removed = 0
    for f in BACKUP_DIR.glob(f"backup-{app_id}-daily-*.json"):
        try:
            # filename format: backup-<app>-daily-YYYYMMDDTHHMMSSz.json
            ts_str = f.stem.split("-")[-1]            # e.g. 20260704T010000Z
            ts = datetime.strptime(ts_str, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            if ts < cutoff:
                f.unlink()
                removed += 1
        except Exception:
            pass
    if removed:
        log(f"  [{app_id}] Limpeza: {removed} backup(s) com mais de {RETAIN_DAYS} dias removido(s)")


def backup_one_app(app, force):
    app_id = app["id"]
    log(f"--- {app_id} ({app['label']}) ---")
    try:
        state = fetch_state(app_id)
    except RuntimeError as e:
        log(f"  ERRO ao buscar Supabase para {app_id}: {e}")
        return False

    if state is None:
        log(f"  ERRO: estado retornado é null para {app_id}")
        return False

    current_hash = state_hash(state)
    last_hash    = load_last_hash(app_id)

    if not force and current_hash == last_hash:
        log(f"  Sem mudanças desde o último backup ({summarize(state)}) — nenhum arquivo salvo")
        return True

    path = save_backup(app_id, state)
    save_hash(app_id, current_hash)
    log(f"  ✓ Salvo: {path.name}")
    log(f"    Estado: {summarize(state)}")

    prune_old_backups(app_id)
    return True


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--app", choices=["main", "br2026", "cdb2026", "all"], default="all")
    p.add_argument("--force", action="store_true", help="Salva mesmo sem mudança")
    args = p.parse_args()

    apps = APPS if args.app == "all" else [a for a in APPS if a["id"] == args.app]

    log("=== Backup diário iniciado ===")
    ok = True
    for app in apps:
        ok = backup_one_app(app, args.force) and ok
    log("=== Backup diário concluído ===\n")
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
