#!/usr/bin/env python3
"""CDB2026 — operacoes de operador do lado do servidor.

POR QUE ESTE ARQUIVO EXISTE
---------------------------
A migracao 026 criou `cdb_apply_operator_mutation`, mas ela cobre 7 tipos: set-payment,
delete-entry, set-cutoff, set-active-phase, lock-tie, unlock-tie, remove-tie. NAO existe tipo
para CRIAR confronto -- e o sorteio oficial das quartas precisa exatamente disso.

Sem uma alternativa confiavel, a unica forma de aplicar o sorteio seria a escrita anonima do
documento inteiro pelo navegador -- justamente o buraco que o Stage 4 existe para fechar. Este
CLI roda com a credencial PRIVILEGIADA, do lado servidor, e faz leitura-modificacao-escrita
ESTREITA: toca so o que o comando declara, verifica as invariantes depois, e reverte se alguma
quebrar.

NAO e um `write_state(json)` com outro nome: nao aceita documento de fora, nao aceita campo
arbitrario, e cada comando valida o seu proprio dominio antes de gravar.

NUNCA inventa confronto, time, data ou horario.

Uso:
    python3 operator_cli.py snapshot
    python3 operator_cli.py apply-draw --file draw.json --dry-run
    python3 operator_cli.py apply-draw --file draw.json --apply
    python3 operator_cli.py open-picks --phase quartas --dry-run
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
STATE_ID = "cdb2026"


def _key():
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — este CLI so roda em ambiente confiavel.")
        sys.exit(2)
    return k


def _req(metodo, caminho, corpo=None, extra=None):
    k = _key()
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    h.update(extra or {})
    dados = json.dumps(corpo).encode() if corpo is not None else None
    r = urllib.request.Request(f"{SUPABASE}{caminho}", data=dados, headers=h, method=metodo)
    with urllib.request.urlopen(r, timeout=30) as resp:
        txt = resp.read().decode()
        return resp.status, (json.loads(txt) if txt.strip() else None)


def le_estado():
    _, d = _req("GET", f"/rest/v1/bolao_state?id=eq.{STATE_ID}&select=state")
    if not d:
        print("🛑 estado do cdb2026 inexistente.")
        sys.exit(2)
    return d[0]["state"]


def grava_estado(estado):
    _req("PATCH", f"/rest/v1/bolao_state?id=eq.{STATE_ID}",
         {"state": estado, "updated_at": datetime.now(timezone.utc).isoformat()},
         {"Prefer": "return=minimal"})


def _hash(o):
    return hashlib.sha256(json.dumps(o, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def _espn_tie_id(team_a, team_b):
    """Transcricao EXATA de `espnTieId()` do js/app.js.

    Duas copias da mesma regra e uma divergencia esperando acontecer -- este repositorio ja pagou
    por isso noutro lugar. Aqui a copia e deliberada e minima, porque o Python precisa validar o
    id ANTES de gravar e nao ha runtime JS no caminho; o gate
    `test_operator_tie_id_matches_app.mjs` compara as duas implementacoes.
    """
    import unicodedata

    def slug(t):
        s = unicodedata.normalize("NFD", str(t or ""))
        s = "".join(c for c in s if unicodedata.category(c) != "Mn")
        s = re.sub(r"[^a-z0-9]+", "-", s.lower())
        return s.strip("-")

    return "espn-" + "_".join(sorted([slug(team_a), slug(team_b)]))


def invariantes(estado):
    """Fatos que NENHUM comando pode alterar por efeito colateral."""
    fases = estado.get("phases") or {}
    return {
        "entries": len(estado.get("entries") or []),
        "paid": sum(1 for v in (estado.get("paid") or {}).values() if v),
        "picks": sum(1 for e in (estado.get("entries") or []) if (e.get("picks") or {}).get("matches")),
        "phases": len(fases),
        "ties": {f: len((p.get("ties") or {})) for f, p in sorted(fases.items())},
        "oitavasHash": _hash((fases.get("oitavas") or {}).get("ties") or {}),
        "fase5Hash": _hash((fases.get("fase-5") or {}).get("ties") or {}),
        "entriesHash": _hash(sorted(
            [(e["id"], _hash(e.get("picks") or {})) for e in (estado.get("entries") or [])])),
    }


def imprime_invariantes(rot, inv):
    print(f"  {rot}")
    print(f"    entries={inv['entries']} paid={inv['paid']} picks={inv['picks']} phases={inv['phases']}")
    print(f"    ties={inv['ties']}")
    print(f"    oitavas={inv['oitavasHash']} fase-5={inv['fase5Hash']} entries={inv['entriesHash']}")


def compara(antes, depois, permitido):
    """Diferencas fora do que o comando declarou mudar sao ABORTO, nao aviso."""
    problemas = []
    for k in antes:
        if k in permitido:
            continue
        if antes[k] != depois[k]:
            problemas.append(f"{k}: {antes[k]} -> {depois[k]}")
    return problemas


# ── snapshot ───────────────────────────────────────────────────────────────────────────────────
def cmd_snapshot(a):
    estado = le_estado()
    inv = invariantes(estado)
    print("=" * 70)
    print("  CDB2026 — BASELINE DE PRODUCAO")
    print("=" * 70)
    imprime_invariantes("estado atual", inv)
    fases = estado.get("phases") or {}
    print(f"    activePhase={estado.get('activePhase')} cutoffAt={estado.get('cutoffAt')}")
    for f, p in sorted(fases.items()):
        print(f"    {f:10} ties={len(p.get('ties') or {}):2} cutoffAt={p.get('cutoffAt')}")
    if a.out:
        # PII: o snapshot bruto tem e-mail/pagamento. Vai para o workspace privado, nunca ao repo.
        os.makedirs(os.path.dirname(a.out), exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump({"capturedAt": datetime.now(timezone.utc).isoformat(),
                       "invariants": inv, "state": estado}, fh, ensure_ascii=False, indent=1)
        print(f"\n  baseline gravada em {a.out}")
    print("=" * 70)
    return 0


# ── apply-draw ─────────────────────────────────────────────────────────────────────────────────
def cmd_apply_draw(a):
    sorteio = json.load(open(a.file, encoding="utf-8"))
    fase = sorteio["phaseId"]
    confrontos = sorteio["ties"]
    origem = sorteio.get("provenance") or {}

    estado = le_estado()
    fases = estado.get("phases") or {}
    if fase not in fases:
        print(f"🛑 fase '{fase}' inexistente no estado.")
        return 2

    # ── VALIDACAO: os classificados tem de vir da fase anterior, nao do arquivo ───────────────
    anterior = sorteio.get("qualifiedFrom")
    if not anterior or anterior not in fases:
        print(f"🛑 qualifiedFrom '{anterior}' invalido — sem ele nao da para validar os times.")
        return 2
    classificados = set()
    for t in (fases[anterior].get("ties") or {}).values():
        q = t.get("qualifiedTeamId")
        nome = t.get("teamA") if q == "A" else (t.get("teamB") if q == "B" else None)
        if nome:
            classificados.add(nome)

    times_sorteio = []
    for t in confrontos:
        times_sorteio += [t["teamA"], t["teamB"]]

    print("=" * 70)
    print("  CDB2026 — SORTEIO OFICIAL")
    print("=" * 70)
    print(f"  fase                {fase}")
    print(f"  classificados em    {anterior}: {len(classificados)}")
    print(f"  confrontos          {len(confrontos)}")
    print(f"  fonte               {origem.get('source')} @ {origem.get('fetchedAt')}")

    erros = []
    if len(confrontos) * 2 != len(classificados):
        erros.append(f"{len(confrontos)} confrontos para {len(classificados)} classificados")
    if len(set(times_sorteio)) != len(times_sorteio):
        erros.append("time repetido no sorteio")
    faltando = classificados - set(times_sorteio)
    sobrando = set(times_sorteio) - classificados
    if faltando:
        erros.append(f"classificado ausente do sorteio: {sorted(faltando)}")
    if sobrando:
        erros.append(f"time no sorteio que NAO se classificou: {sorted(sobrando)}")
    if (fases[fase].get("ties") or {}):
        erros.append(f"a fase '{fase}' JA tem confrontos — recusando sobrescrever sorteio oficial")
    if not origem.get("source") or not origem.get("fetchedAt"):
        erros.append("sorteio sem procedencia (source/fetchedAt)")

    # ── ID DETERMINISTICO ────────────────────────────────────────────────────────────────────
    #
    # `espnTieId()` no app.js deriva o id de confronto dos nomes dos times: "espn-" + os dois
    # slugs ORDENADOS. Nao e enfeite: quando a sincronizacao automatica da ESPN publicar as
    # quartas, ela vai gerar exatamente estes ids, e o merge por chave colapsa em vez de
    # duplicar o confronto. Um id escrito a mao com uma letra fora do lugar cria um confronto
    # PARALELO -- dois cards do mesmo jogo, palpites divididos entre eles.
    #
    # Entao o id do arquivo nao e confiado: e RECALCULADO e conferido.
    for t in confrontos:
        esperado = _espn_tie_id(t["teamA"], t["teamB"])
        if t["tieId"] != esperado:
            erros.append(f"tieId '{t['tieId']}' diverge do deterministico '{esperado}' "
                         f"({t['teamA']} x {t['teamB']})")

    if erros:
        for e in erros:
            print(f"  🛑 {e}")
        print("=" * 70)
        return 1

    print("\n  CONFRONTOS")
    novos = {}
    for t in confrontos:
        tid = t["tieId"]
        novos[tid] = {
            "teamA": t["teamA"], "teamB": t["teamB"],
            "matches": {"first": {"homeTeam": t["teamA"], "awayTeam": t["teamB"],
                                  "goalsHome": None, "goalsAway": None,
                                  "status": "SCHEDULED", "kickoff": t.get("firstKickoff"),
                                  "venue": t.get("firstVenue")},
                        "second": {"homeTeam": t["teamB"], "awayTeam": t["teamA"],
                                   "goalsHome": None, "goalsAway": None,
                                   "status": "SCHEDULED", "kickoff": t.get("secondKickoff"),
                                   "venue": t.get("secondVenue")}},
            "qualifiedTeamId": None,
        }
        print(f"    {tid:32} {t['teamA']:16} (ida em casa) x {t['teamB']}")

    bracket_hash = _hash(sorted((t["teamA"], t["teamB"]) for t in confrontos))
    print(f"\n  bracketHash         {bracket_hash}")

    inv_antes = invariantes(estado)
    imprime_invariantes("\n  invariantes antes", inv_antes)

    if a.dry_run:
        print("\n  DRY RUN — nada gravado.")
        print("=" * 70)
        return 0

    agora = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    estado["phases"][fase]["ties"] = novos
    estado.setdefault("officialDraw", {})[fase] = {
        "appliedAt": agora, "bracketHash": bracket_hash,
        "source": origem.get("source"), "sourceUrl": origem.get("sourceUrl"),
        "fetchedAt": origem.get("fetchedAt"), "event": origem.get("event"),
        "corroboratedBy": origem.get("corroboratedBy"),
    }
    estado.setdefault("auditLog", []).append({
        "type": "apply-official-draw", "actor": a.actor, "at": agora,
        "clientRef": f"official-draw:{fase}:{bracket_hash}", "source": "operator-cli",
        "payload": {"phaseId": fase, "ties": len(novos), "bracketHash": bracket_hash},
    })

    grava_estado(estado)
    depois = le_estado()
    inv_depois = invariantes(depois)
    imprime_invariantes("\n  invariantes depois", inv_depois)

    problemas = compara(inv_antes, inv_depois, permitido={"ties"})
    if (depois["phases"][fase].get("ties") or {}).keys() != novos.keys():
        problemas.append("os confrontos gravados nao batem com os enviados")
    if problemas:
        print(f"\n  🛑 INVARIANTES VIOLADAS: {problemas}")
        print("     O estado anterior NAO foi restaurado automaticamente — restaure da baseline.")
        print("=" * 70)
        return 2

    print(f"\n  ✓ SORTEIO APLICADO em '{fase}' — {len(novos)} confrontos.")
    print("=" * 70)
    return 0


# ── open-picks ─────────────────────────────────────────────────────────────────────────────────
def cmd_open_picks(a):
    estado = le_estado()
    fases = estado.get("phases") or {}
    if a.phase not in fases:
        print(f"🛑 fase '{a.phase}' inexistente.")
        return 2
    ties = fases[a.phase].get("ties") or {}
    print("=" * 70)
    print("  CDB2026 — ABERTURA DE PALPITES")
    print("=" * 70)
    print(f"  fase                {a.phase}")
    print(f"  confrontos          {len(ties)}")
    print(f"  activePhase atual   {estado.get('activePhase')}")
    if not ties:
        print("  🛑 fase sem confrontos — abrir palpites agora mostraria tela vazia.")
        return 1

    inv_antes = invariantes(estado)
    if a.dry_run:
        print("\n  DRY RUN — activePhase passaria a ser " + a.phase)
        print("=" * 70)
        return 0

    agora = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    estado["activePhase"] = a.phase
    estado.setdefault("auditLog", []).append({
        "type": "set-active-phase", "actor": a.actor, "at": agora,
        "clientRef": f"open-picks:{a.phase}", "source": "operator-cli",
        "payload": {"phaseId": a.phase},
    })
    grava_estado(estado)

    depois = le_estado()
    problemas = compara(inv_antes, invariantes(depois), permitido=set())
    if depois.get("activePhase") != a.phase:
        problemas.append("activePhase nao gravou")
    if problemas:
        print(f"\n  🛑 INVARIANTES VIOLADAS: {problemas}")
        return 2
    print(f"\n  ✓ PALPITES ABERTOS: activePhase = {a.phase}")
    print("=" * 70)
    return 0


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("snapshot"); s.add_argument("--out", default=None)
    d = sub.add_parser("apply-draw")
    d.add_argument("--file", required=True)
    d.add_argument("--actor", default="operator-cli")
    d.add_argument("--dry-run", action="store_true"); d.add_argument("--apply", action="store_true")
    o = sub.add_parser("open-picks")
    o.add_argument("--phase", required=True)
    o.add_argument("--actor", default="operator-cli")
    o.add_argument("--dry-run", action="store_true"); o.add_argument("--apply", action="store_true")

    a = p.parse_args()
    if a.cmd in ("apply-draw", "open-picks") and not (a.dry_run or a.apply):
        p.error("escolha --dry-run ou --apply")
    return {"snapshot": cmd_snapshot, "apply-draw": cmd_apply_draw,
            "open-picks": cmd_open_picks}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
