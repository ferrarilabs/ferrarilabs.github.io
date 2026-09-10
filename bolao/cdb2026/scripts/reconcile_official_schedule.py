#!/usr/bin/env python3
"""CDB2026 — vigia a tabela detalhada oficial de uma fase e materializa data/prazo sozinho.

POR QUE EXISTE
--------------
Nasceu so pelas quartas (o sorteio ja tinha acontecido, so faltava a CBF publicar data/hora).
Generalizado (Issue #428) para tambem cobrir semifinal/final -- fases DERIVADAS, cujos confrontos
ja vem materializados por `materialize-derived-phase` (#410; time vem de `qualifiedTeamId`
persistido, nunca inventado aqui). Nos dois casos a regra de negocio e a mesma: o palpite NAO abre
sem prazo -- sem horario nao ha o que fechar, e um formulario aberto sem prazo aceitaria palpite
depois de a bola rolar.

Sem este vigia, alguem teria de perceber que a CBF publicou e voltar para rodar um comando. Isso
nao e automacao -- e um alarme na cabeca de uma pessoa. E foi exatamente essa classe de coisa que
fez o e-mail do Powerball de 10/08 nao sair.

DELIBERADAMENTE NAO AUTOMATIZADO POR CRON PARA FASES DERIVADAS. A Issue #411 decidiu, com evidencia,
NAO automatizar a materializacao de fase derivada (quem joga contra quem) por ser rara (2x por
torneio) e ter custo de erro assimetrico -- grava chaveamento de torneio em producao. A materializacao
de TIME ja segue essa decisao (continua manual, via `materialize-derived-phase`). Esta ferramenta so
grava DATA/PRAZO sobre confrontos ja materializados -- nunca decide quem avanca, nunca toca
`qualifiedTeamId`, nunca toca scoring/entradas/pagamento -- mas, pela mesma logica de frequencia e
custo de erro do #411, o CICLO DE PUBLICACAO DA CBF (`schedule:` cron) continua ligado SO para
quartas. Para uma fase derivada isto roda por `workflow_dispatch` explicito (operador aciona quando
sabe que a CBF publicou), nunca sozinho num cron -- mesmo padrao operador-controlado que o #411
endossou como suficiente.

O QUE FAZ QUANDO A TABELA APARECE
---------------------------------
    valida competicao/temporada/fase
    quartas: confere os confrontos contra o officialDraw ja gravado (nao aceita chaveamento novo)
    fase derivada: confere os confrontos contra os ja materializados (nao aceita confronto novo)
    grava data/hora de cada jogo com proveniencia
    calcula FIRST_OFFICIAL_KICKOFF = menor kickoff das IDAS
    calcula CUTOFF = FIRST_OFFICIAL_KICKOFF - 1h
    abre os palpites

NUNCA inventa data, horario ou confronto. Sem tabela publicada, sai com exit 0 dizendo
WAITING_FOR_OFFICIAL_SCHEDULE -- que e um estado de negocio normal, nao uma falha.

Uso:
    python3 reconcile_official_schedule.py --dry-run [--phase quartas|semifinal|final]
    python3 reconcile_official_schedule.py --apply [--phase quartas|semifinal|final]
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

FASES_VALIDAS = ("quartas", "semifinal", "final")
# Fases DERIVADAS (#410): confrontos vem de materialize-derived-phase, nao de sorteio. Mesmo mapa
# de operator_cli.FASES_DERIVADAS, repetido aqui de proposito -- regra de plataforma: cada app so
# le o proprio estado, nenhuma importacao entre scripts alem do operator_cli local do proprio app.
FASES_DERIVADAS = {"semifinal": "quartas", "final": "semifinal"}
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


# JANELA MAXIMA CARACTERIZADA CONTRA A FONTE (2026-08-12, remedida 2026-09-10).
#
# O endpoint de scoreboard da ESPN devolve LISTA VAZIA -- sem erro, sem aviso -- quando o
# intervalo `dates=` e largo demais. Medido em 2026-08-12 (quartas ja publicadas):
#
#     7d -> 0     14d -> 3     21d -> 7     30d -> 8     45d -> 8     60d -> 8     90d -> 0
#
# 45 dias era suficiente para as quartas (ida-volta de 9 dias, 25/08-03/09), mas NAO alcancava a
# semifinal: a #410 materializou o chaveamento em 2026-08-11, e a CBF so publicou os horarios para
# 01/11 (ida) e 08/11 (volta) -- um gap de ~52 dias entre "confronto materializado" e "primeiro
# kickoff" que 45 dias nunca alcancaria, mesmo com a #428 (generalizacao para fase derivada) ja no
# ar. Remedido em 2026-09-10, com a semifinal ja publicada:
#
#     45d -> 0    53d -> 2    60d -> 4    70d -> 4    75d -> 4    80d -> 4    85d -> 4
#     88d -> 5    89d -> 5    90d -> 0    91d -> 5
#
# O limite NAO e um teto liso -- 90d caiu para zero enquanto 89d e 91d nao, o mesmo tipo de
# resposta vazia sem erro que a medicao original ja descrevia, so que sem ser uma funcao monotona
# da largura. Nao ha teto seguro conhecido acima de ~85d; 75d fica com folga real dos dois lados:
# bem acima do que a semifinal precisou (60d ja bastava para as duas pernas) e bem abaixo de onde
# a instabilidade comecou a aparecer.
JANELA_MAX_DIAS = 75


def busca_tabela(de, ate):
    """Jogos publicados na janela. (eventos, erro).

    A janela e VALIDADA aqui, e nao no chamador, porque o modo de falha e silencioso: quem
    alargar o intervalo la em cima nao veria erro nenhum, so veria o torneio parar de encontrar
    jogos que existem.
    """
    if (ate - de).days > JANELA_MAX_DIAS:
        return None, (f"JANELA_LARGA_DEMAIS: {(ate - de).days}d > {JANELA_MAX_DIAS}d. "
                      "A fonte devolve lista vazia sem erro nesse caso, e vazio aqui seria lido "
                      "como 'tabela nao publicada'.")
    url = ESPN_URL.format(de=de.strftime("%Y%m%d"), ate=ate.strftime("%Y%m%d"))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read()).get("events") or [], None
    except Exception as e:
        return None, f"FONTE_INDISPONIVEL: {type(e).__name__}"


# A fonte e o sorteio nomeiam o mesmo clube de formas diferentes. Medido em 2026-08-12: a ESPN
# publica "Vasco da Gama", o sorteio oficial registrou "Vasco". Tres dos quatro confrontos casavam
# e esse nao -- e como publicacao PARCIAL e recusada de proposito, um unico nome divergente
# segurava a tabela inteira.
#
# O apelido vai do lado da FONTE para o lado do SORTEIO, nunca o contrario: o documento oficial e
# a autoridade sobre como o clube se chama neste torneio, e reescreve-lo para agradar a fonte
# inverteria quem manda.
#
# Repetido aqui, e nao importado de bolao/copa2026 ou bolao/shared, pela regra de plataforma: os
# apps nao importam codigo um do outro. O mesmo motivo pelo qual o User-Agent acima e repetido.
ESPN_APELIDOS = {
    "vasco-da-gama": "vasco",
}


def casa_confronto(ev, pares):
    """Qual confronto oficial este jogo representa? None se nao for nenhum deles."""
    comp = (ev.get("competitions") or [{}])[0]
    times = [c.get("team", {}).get("displayName") or c.get("team", {}).get("name")
             for c in (comp.get("competitors") or [])]
    if len(times) != 2:
        return None, None
    chave = tuple(sorted(ESPN_APELIDOS.get(_slug(t), _slug(t)) for t in times))
    return pares.get(chave), times


def fase_esta_pronta(ties, od, derivada):
    """Ha confrontos casaveis contra uma fonte de verdade autoritativa?

    Quartas: os confrontos vem de sorteio -- sem `officialDraw.validatedAt` nao ha o que casar.
    Fase derivada (semifinal/final): os confrontos vem de `materialize-derived-phase` (#410), que
    ja exige topologia AUTORITATIVA antes de gravar `ties` -- a existencia de `ties` aqui JA e a
    prova de que aquele comando (manual, nunca este script) validou o chaveamento. Nao ha
    officialDraw equivalente para fase derivada, e exigi-lo travaria a fase para sempre.
    """
    return bool(ties) and (derivada or bool(od.get("validatedAt")))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--phase", default="quartas", choices=FASES_VALIDAS)
    p.add_argument("--actor", default="schedule-reconciler")
    a = p.parse_args()
    if not (a.dry_run or a.apply):
        p.error("escolha --dry-run ou --apply")

    FASE = a.phase
    derivada = FASE in FASES_DERIVADAS

    estado = OP.le_estado()
    fase = (estado.get("phases") or {}).get(FASE) or {}
    ties = fase.get("ties") or {}
    od = fase.get("officialDraw") or {}

    print("=" * 70)
    print(f"  CDB2026 — TABELA OFICIAL: {FASE.upper()}")
    print("=" * 70)
    print(f"  confrontos gravados   {len(ties)}")
    if derivada:
        print(f"  fase derivada de      {FASES_DERIVADAS[FASE]} (materializacao via #410, manual)")
    else:
        print(f"  sorteio validado      {bool(od.get('validatedAt'))}")

    # Quartas: os confrontos vem de sorteio -- sem officialDraw.validatedAt nao ha o que casar.
    # Fase derivada: os confrontos vem de materialize-derived-phase (#410), que ja exige topologia
    # AUTORITATIVA antes de gravar `ties` -- a existencia de `ties` aqui JA e a prova de que aquele
    # comando (manual, nunca este script) validou o chaveamento. Nao ha officialDraw equivalente.
    pronta = bool(ties) and (derivada or bool(od.get("validatedAt")))
    if not pronta:
        status = "WAITING_FOR_DERIVED_MATERIALIZATION" if derivada else "WAITING_FOR_OFFICIAL_DRAW"
        print(f"  CDB_SCHEDULE_STATUS = {status}")
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
    eventos, erro = busca_tabela(hoje, hoje + timedelta(days=JANELA_MAX_DIAS))
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
        print(f"     (a CBF ainda nao publicou a tabela COMPLETA de {FASE})")
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

    # MUTACOES ESTREITAS, uma por fato. Isto era `OP.grava_estado(estado)` -- um PATCH do
    # documento inteiro herdado do operator_cli, com a mesma janela de perda entre a leitura e a
    # gravacao. Cada chamada abaixo carrega o seu proprio client_ref, entao um retry do reconciler
    # nao aplica nada duas vezes.
    for tid, quando in idas.items():
        OP._rpc("backfill-kickoff", {"phaseId": FASE, "tieId": tid, "leg": "first", "kickoff": quando},
                f"schedule:{FASE}:{tid}:first:{quando}", a.actor)
        jogos = sorted(achados[tid])
        if len(jogos) > 1:
            OP._rpc("backfill-kickoff", {"phaseId": FASE, "tieId": tid, "leg": "second", "kickoff": jogos[1][0]},
                    f"schedule:{FASE}:{tid}:second:{jogos[1][0]}", a.actor)
    OP._rpc("set-cutoff", {"phaseId": FASE, "cutoffAt": cutoff_iso},
            f"schedule-cutoff:{FASE}:{cutoff_iso}", a.actor)
    OP._rpc("set-schedule-provenance",
            {"phaseId": FASE, "scheduleProvenance": estado["phases"][FASE]["scheduleProvenance"]},
            f"schedule-prov:{FASE}:{primeiro}", a.actor)
    depois = OP.le_estado()
    problemas = OP.compara(inv_antes, OP.invariantes(depois), permitido=set())
    if (depois["phases"][FASE].get("cutoffAt")) != cutoff_iso:
        problemas.append("cutoffAt nao gravou")
    if problemas:
        print(f"\n  🛑 INVARIANTES VIOLADAS: {problemas}")
        print("=" * 70)
        return 2

    print(f"\n  ✓ TABELA MATERIALIZADA — palpites de {FASE} ABERTOS ate {cutoff_iso}")
    print("  CDB_SCHEDULE_STATUS = MATERIALIZED | PICKS_OPEN = YES | DATA_MUTATIONS = 1")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
