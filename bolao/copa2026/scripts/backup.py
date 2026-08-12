#!/usr/bin/env python3
"""
backup.py — Snapshot completo: código (git tag) + dados (Supabase → JSON local).

Cobre os três apps do bolão (mesma tabela Supabase, uma linha por app — ver
docs/bolao/DATABASE_SETUP_SUPABASE.md "Múltiplos apps na mesma tabela"): Copa do Mundo
2026 (id="main"), Brasileirão 2026 (id="br2026"), Copa do Brasil 2026 (id="cdb2026").
Extensão de 2026-07-16 (Eduardo: "the same way copa has, this also needs to have backups
done") — antes só cobria a Copa.

Uso:
  python3 bolao/scripts/backup.py                    # todos os apps, tag automática
  python3 bolao/scripts/backup.py --app br2026        # só um app
  python3 bolao/scripts/backup.py --label pre-r16     # tag/label personalizada
  python3 bolao/scripts/backup.py --data-only         # só dados, sem git tag
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

# ── Config (lido de js/config.js de cada app via grep, sem import JS) ─────────────────────
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

BACKUP_DIR = os.path.join(os.path.dirname(__file__), "..", "backups")


ALLOWED_POOLS = {"main", "br2026", "cdb2026"}


def fetch_supabase_state(state_id):
    if state_id not in ALLOWED_POOLS:
        raise SystemExit(f"🛑 pool nao autorizado para backup: {state_id}")
    url = f"{SUPABASE_URL}/rest/v1/{TABLE}?id=eq.{state_id}&select=*"
    req = urllib.request.Request(url, headers={
        "apikey": _service_key(),
        "Authorization": f"Bearer {_service_key()}",
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
        print(f"  ✗ Nenhuma linha retornada do Supabase para id={state_id}.", file=sys.stderr)
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


def save_backup(app_id, state, label):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"backup-{app_id}-{label}-{ts}.json"
    path = os.path.join(BACKUP_DIR, filename)
    payload = {
        "app": app_id,
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
    n_paid   = sum(1 for v in paid.values() if v)
    return f"  {len(entries)} entrada(s) · {n_paid} pago(s)"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--app", choices=["main", "br2026", "cdb2026", "all"], default="all")
    p.add_argument("--label", default="")
    p.add_argument("--data-only", action="store_true")
    args = p.parse_args()

    ts_label = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    label = (args.label + "-" + ts_label) if args.label else ts_label

    apps = APPS if args.app == "all" else [a for a in APPS if a["id"] == args.app]

    print(f"\n=== Backup Bolão — {label} ===\n")

    # 1. Dados Supabase (um por app)
    print("1. Buscando estado do Supabase…")
    any_ok = False
    for app in apps:
        print(f"  [{app['id']}] {app['label']}")
        state = fetch_supabase_state(app["id"])
        if state is None:
            print(f"    AVISO: backup de dados não foi possível para {app['id']}.")
            continue
        path = save_backup(app["id"], state, label)
        print(f"    ✓ Salvo em: {path}")
        print(f"   {summarize(state)}")
        any_ok = True
    if not any_ok:
        print("  AVISO: nenhum app teve dados salvos. Continuando com tag de código apenas.")

    # 2. Git tag (código, único para todos os apps — mesmo repositório)
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
