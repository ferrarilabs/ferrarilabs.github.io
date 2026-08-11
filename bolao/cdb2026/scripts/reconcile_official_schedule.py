#!/usr/bin/env python3
"""CDB2026 — vigia a tabela detalhada oficial das quartas e abre os palpites sozinho.

POR QUE EXISTE
--------------
O sorteio das quartas ja aconteceu e os quatro confrontos estao em producao, mas a CBF ainda nao
publicou datas e horarios. Pela regra de negocio o palpite NAO abre sem prazo: sem horario nao ha
o que fechar, e um formulario aberto sem prazo aceitaria palpite depois de a bola rolar.

Sem este vigia, alguem teria de perceber que a CBF publicou e voltar para rodar um comando. Isso
nao e automacao -- e um alarme na cabeca de uma pessoa. E foi exatamente essa classe de coisa que
fez o e-mail do Powerball de 10/08 nao sair.

O QUE FAZ QUANDO A TABELA APARECE
---------------------------------
    valida competicao/temporada/fase
    confere os confrontos contra o officialDraw ja gravado (nao aceita chaveamento novo)
    grava data/hora de cada jogo com proveniencia
    calcula FIRST_OFFICIAL_KICKOFF = menor kickoff das IDAS
    calcula CUTOFF = FIRST_OFFICIAL_KICKOFF - 1h
    abre os palpites

NUNCA inventa data, horario ou confronto. Sem tabela publicada, sai com exit 0 dizendo
WAITING_FOR_OFFICIAL_SCHEDULE -- que e um estado de negocio normal, nao uma falha.

Uso:
    python3 reconcile_official_schedule.py --dry-run
    python3 reconcile_official_schedule.py --apply
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import operator_cli as OP          # reusa leitura/escrita/invariantes -- um caminho de estado so

FASE = "quartas"
CUTOFF_ANTES_MS = 3600000          # 1 hora, a regra de negocio
COMPETICAO_ESPN = "bra.copa_do_brazil"
ESPN_URL = ("https://site.api.espn.com/apis/site/v2/sports/soccer/"
            f"{COMPETICAO_ESPN}/scoreboard?dates={{de}}-{{ate}}&limit=300")
# A ESPN 403 qualquer User-Agent "de navegador" e aceita o do curl. Caracterizado em
# bolao/shared/scripts/espn_provider.py; repetido aqui de proposito para nao criar dependencia
# entre apps (regra da plataforma: os tres bolões não importam código um do outro).
UA = "curl/8.7.1"


def _slug(t):
    import re
    import unicodedata
    s = unicodedata.normalize("NFD", str(t or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def busca_tabela(de, ate):
    """Jogos publicados na janela. (eventos, erro)."""
    url = ESPN_URL.format(de=de.strftime("%Y%m%d"), ate=ate.strftime("%Y%m%d"))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read()).get("events") or [], None
    except Exception as e:
        return None, f"FONTE_INDISPONIVEL: {type(e).__name__}"


def casa_confronto(ev, pares):
    """Qual confronto oficial este jogo representa? None se nao for nenhum deles."""
    comp = (ev.get("competitions") or [{}])[0]
    times = [c.get("team", {}).get("displayName") or c.get("team", {}).get("name")
             for c in (comp.get("competitors") or [])]
    if len(times) != 2:
        return None, None
    chave = tuple(sorted(_slug(t) for t in times))
    return pares.get(chave), times


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--actor", default="schedule-reconciler")
    a = p.parse_args()
    if not (a.dry_run or a.apply):
        p.error("escolha --dry-run ou --apply")

    estado = OP.le_estado()
    fase = (estado.get("phases") or {}).get(FASE) or {}
    ties = fase.get("ties") or {}
    od = fase.get("officialDraw") or {}

    print("=" * 70)
    print("  CDB2026 — TABELA OFICIAL DAS QUARTAS")
    print("=" * 70)
    print(f"  confrontos gravados   {len(ties)}")
    print(f"  sorteio validado      {bool(od.get('validatedAt'))}")

    if not ties or not od.get("validatedAt"):
        print("  CDB_SCHEDULE_STATUS = WAITING_FOR_OFFICIAL_DRAW")
        print("  PICKS_OPEN = NO | DATA_MUTATIONS = 0")
        print("=" * 70)
        return 0

    if fase.get("cutoffAt"):
        print(f"  cutoffAt ja definido  {fase['cutoffAt']}")
        print("  CDB_SCHEDULE_STATUS = ALREADY_MATERIALIZED")
        print("  DATA_MUTATIONS = 0")
        print("=" * 70)
        return 0

    # Indice dos confrontos OFICIAIS por par de times. A tabela so pode CONFIRMAR o que o sorteio
    # ja definiu -- se a fonte trouxer um par que nao existe no officialDraw, e chaveamento novo,
    # e chaveamento novo nao entra por aqui.
    pares = {tuple(sorted((_slug(t["teamA"]), _slug(t["teamB"])))): tid
             for tid, t in ties.items()}

    hoje = datetime.now(timezone.utc)
    eventos, erro = busca_tabela(hoje, hoje + timedelta(days=90))
    if erro:
        print(f"  UPSTREAM_NOT_READY = {erro}")
        print("  CDB_SCHEDULE_STATUS = WAITING_FOR_OFFICIAL_SCHEDULE")
        print("  PICKS_OPEN = NO | DATA_MUTATIONS = 0")
        print("=" * 70)
        return 0

    achados = {}
    for ev in eventos:
        tid, times = casa_confronto(ev, pares)
        if not tid:
            continue
        quando = ev.get("date")
        if not quando:
            continue
        achados.setdefault(tid, []).append((quando, times))

    print(f"  jogos na fonte        {len(eventos)}")
    print(f"  confrontos com data   {len(achados)}/{len(ties)}")

    if len(achados) < len(ties):
        # Publicacao PARCIAL nao serve: o prazo e o menor kickoff de TODOS. Materializar com
        # metade da tabela produziria um prazo que a proxima publicacao invalidaria.
        print("  CDB_SCHEDULE_STATUS = WAITING_FOR_OFFICIAL_SCHEDULE")
        print("     (a CBF ainda nao publicou a tabela COMPLETA das quartas)")
        print("  PICKS_OPEN = NO | DATA_MUTATIONS = 0")
        print("=" * 70)
        return 0

    # IDA = o jogo mais cedo de cada confronto.
    idas = {}
    for tid, jogos in achados.items():
        jogos.sort()
        idas[tid] = jogos[0][0]
    primeiro = min(idas.values())
    primeiro_ms = int(datetime.fromisoformat(primeiro.replace("Z", "+00:00")).timestamp() * 1000)
    cutoff_ms = primeiro_ms - CUTOFF_ANTES_MS
    cutoff_iso = datetime.fromtimestamp(cutoff_ms / 1000, timezone.utc).isoformat().replace("+00:00", "Z")

    print(f"  primeiro jogo (ida)   {primeiro}")
    print(f"  CUTOFF (ida - 1h)     {cutoff_iso}")
    for tid, quando in sorted(idas.items(), key=lambda kv: kv[1]):
        print(f"    {tid:32} {quando}")

    if a.dry_run:
        print("\n  DRY RUN — nada gravado.")
        print("=" * 70)
        return 0

    inv_antes = OP.invariantes(estado)
    agora = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    for tid, quando in idas.items():
        estado["phases"][FASE]["ties"][tid]["matches"]["first"]["kickoff"] = quando
        jogos = sorted(achados[tid])
        if len(jogos) > 1:
            estado["phases"][FASE]["ties"][tid]["matches"]["second"]["kickoff"] = jogos[1][0]
    estado["phases"][FASE]["cutoffAt"] = cutoff_iso
    estado["phases"][FASE]["scheduleProvenance"] = {
        "source": "espn", "competition": COMPETICAO_ESPN,
        "fetchedAt": agora, "firstKickoff": primeiro,
        "cutoffRule": "primeiro kickoff de ida menos 1 hora",
    }
    estado.setdefault("auditLog", []).append({
        "type": "materialize-official-schedule", "actor": a.actor, "at": agora,
        "clientRef": f"schedule:{FASE}:{primeiro}", "source": "schedule-reconciler",
        "payload": {"phaseId": FASE, "firstKickoff": primeiro, "cutoffAt": cutoff_iso},
    })

    OP.grava_estado(estado)
    depois = OP.le_estado()
    problemas = OP.compara(inv_antes, OP.invariantes(depois), permitido=set())
    if (depois["phases"][FASE].get("cutoffAt")) != cutoff_iso:
        problemas.append("cutoffAt nao gravou")
    if problemas:
        print(f"\n  🛑 INVARIANTES VIOLADAS: {problemas}")
        print("=" * 70)
        return 2

    print(f"\n  ✓ TABELA MATERIALIZADA — palpites das quartas ABERTOS ate {cutoff_iso}")
    print("  CDB_SCHEDULE_STATUS = MATERIALIZED | PICKS_OPEN = YES | DATA_MUTATIONS = 1")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
