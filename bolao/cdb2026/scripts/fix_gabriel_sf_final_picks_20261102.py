#!/usr/bin/env python3
"""
Ação ÚNICA de operador (2026-11-02): completa a entrada manual do Gabriel Ferrari de 2026-08-26.

Naquele dia o Eduardo autorizou entrar as quartas do Gabriel e "copiar o resto (quem avança nas
quartas + semifinal + final) da entrada do próprio Eduardo Ferrari". O script de então
(fix_gabriel_quartas_picks_20260826.py, já aposentado) copiou só o `qualified` dos slots
sf-1/sf-2/final-1 e deixou os PLACARES de fora. Resultado: o Gabriel aparecia "sem palpite" na
semifinal e na final. Em 2026-11-02 o Eduardo confirmou: "Eu simplesmente copiei os meus
palpites para o dele."

Este script grava em `picks.matches` do Gabriel exatamente os placares do Eduardo nos slots
sf-1, sf-2 e final-1. Esses slots são virtuais: só existem no documento `bolao_state` (o
normalizado não os modela, ver 20260816020000), e é de lá que o site e o e-mail leem.

NÃO envia e-mail, NÃO toca outbox, cutoffAt, activePhase, resultados nem outra entrada.

Guardas:
  1. aborta se o Gabriel já tiver QUALQUER placar em sf-1/sf-2/final-1 (idempotente se já for
     exatamente o esperado);
  2. aborta se os placares do Eduardo não forem os conferidos em 2026-11-02 (EXPECTED_SOURCE);
  3. aborta se o `qualified` dos slots do Gabriel divergir do Eduardo;
  4. a escrita é condicionada a `updated_at` lido (ninguém escreveu no meio);
  5. relê e confirma que a ÚNICA diferença no documento inteiro são essas 3 chaves.

Uso:
    python3 fix_gabriel_sf_final_picks_20261102.py --dry-run
    python3 fix_gabriel_sf_final_picks_20261102.py --apply
"""
import argparse
import copy
import json
import os
import sys
import urllib.parse
import urllib.request

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
GABRIEL_ID = "2a0eb9e8-7210-4645-aa45-016f7abfa776"
EDUARDO_ID = "03e9fe14-d777-4a71-9c31-3d54dd21a07c"
SLOTS = ("sf-1", "sf-2", "final-1")

# Placares do Eduardo lidos do documento em 2026-11-02 (iguais ao comprovante dele).
EXPECTED_SOURCE = {
    "sf-1": {"first": {"goalsHome": 1, "goalsAway": 1}, "second": {"goalsHome": 2, "goalsAway": 0}},
    "sf-2": {"first": {"goalsHome": 0, "goalsAway": 2}, "second": {"goalsHome": 3, "goalsAway": 2}},
    "final-1": {"single": {"goalsHome": 0, "goalsAway": 2}},
}


def _key():
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente.")
        sys.exit(2)
    return k


def _req(metodo, caminho, corpo=None, prefer=None):
    k = _key()
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    dados = json.dumps(corpo).encode() if corpo is not None else None
    r = urllib.request.Request(f"{SUPABASE}{caminho}", data=dados, headers=h, method=metodo)
    with urllib.request.urlopen(r, timeout=30) as resp:
        txt = resp.read().decode()
        return resp.status, (json.loads(txt) if txt.strip() else None)


def le_linha():
    _, d = _req("GET", "/rest/v1/bolao_state?id=eq.cdb2026&select=state,updated_at")
    if not d:
        print("🛑 estado do cdb2026 inexistente.")
        sys.exit(2)
    return d[0]["state"], d[0]["updated_at"]


def norm(v):
    """Compara placares sem depender da ordem das chaves."""
    return json.dumps(v, sort_keys=True)


def plano(estado):
    """Devolve (estado_novo, status). Função pura: testável sem rede."""
    entries = estado.get("entries") or []
    gab = next((e for e in entries if e.get("id") == GABRIEL_ID), None)
    ed = next((e for e in entries if e.get("id") == EDUARDO_ID), None)
    if gab is None or ed is None:
        return None, "ABORT: entrada do Gabriel ou do Eduardo não encontrada"

    ed_m = (ed.get("picks") or {}).get("matches") or {}
    for s in SLOTS:
        if norm(ed_m.get(s)) != norm(EXPECTED_SOURCE[s]):
            return None, f"ABORT: placar do Eduardo em {s} mudou: {ed_m.get(s)}"

    gq = (gab.get("picks") or {}).get("qualified") or {}
    eq = (ed.get("picks") or {}).get("qualified") or {}
    for s in SLOTS:
        if gq.get(s) != eq.get(s):
            return None, f"ABORT: quem avança do Gabriel em {s} ({gq.get(s)}) != Eduardo ({eq.get(s)})"

    gm = (gab.get("picks") or {}).get("matches") or {}
    if all(norm(gm.get(s)) == norm(EXPECTED_SOURCE[s]) for s in SLOTS):
        return None, "ALREADY_CORRECT"
    ja = [s for s in SLOTS if gm.get(s) is not None]
    if ja:
        return None, f"ABORT: Gabriel já tem placar em {ja}; não sobrescrevo"

    novo = copy.deepcopy(estado)
    g = next(e for e in novo["entries"] if e.get("id") == GABRIEL_ID)
    g.setdefault("picks", {}).setdefault("matches", {})
    for s in SLOTS:
        g["picks"]["matches"][s] = copy.deepcopy(EXPECTED_SOURCE[s])
    return novo, "PLAN"


def sem_slots_do_gabriel(estado):
    e = copy.deepcopy(estado)
    for x in e.get("entries") or []:
        if x.get("id") == GABRIEL_ID:
            for s in SLOTS:
                ((x.get("picks") or {}).get("matches") or {}).pop(s, None)
    return norm(e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if args.dry_run == args.apply:
        print("uso: --dry-run ou --apply")
        return 2

    estado, updated_at = le_linha()
    novo, status = plano(estado)
    print("=" * 70)
    print("  CDB2026 — placares de semifinal/final do Gabriel (cópia do Eduardo)")
    print("=" * 70)
    print(f"  status do plano: {status}")
    if status == "ALREADY_CORRECT":
        return 0
    if status != "PLAN":
        return 1
    for s in SLOTS:
        print(f"  {s}: {json.dumps(EXPECTED_SOURCE[s])}")
    if args.dry_run:
        print("\n  DRY RUN — nada gravado.")
        return 0

    filtro = "id=eq.cdb2026&updated_at=eq." + urllib.parse.quote(updated_at, safe="")
    _, linhas = _req("PATCH", f"/rest/v1/bolao_state?{filtro}", {"state": novo},
                     prefer="return=representation")
    if not linhas or len(linhas) != 1:
        print("🛑 documento mudou entre a leitura e a escrita (0 linhas). Nada gravado; rode de novo.")
        return 1

    depois, _ = le_linha()
    _, status_depois = plano(depois)
    resto_igual = sem_slots_do_gabriel(depois) == sem_slots_do_gabriel(estado)
    print(f"\n  VERIFICAÇÃO: status relido = {status_depois}; resto do documento idêntico = {resto_igual}")
    if status_depois != "ALREADY_CORRECT" or not resto_igual:
        print("  🛑 verificação falhou. INVESTIGAR.")
        return 2
    print("  ✓ GRAVADO — só sf-1/sf-2/final-1 do Gabriel mudaram.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
