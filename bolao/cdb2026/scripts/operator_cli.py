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


def _rpc(tipo, payload, client_ref, actor="operator-cli"):
    """Mutacao ESTREITA no servidor. Este CLI nao grava mais o documento inteiro.

    Aqui havia `grava_estado(estado)`: um PATCH do documento completo. Era o mesmo formato que o
    copa2026 aposentou, e a comparacao de invariantes que este arquivo faz depois de gravar era
    DETECCAO, nao prevencao -- a janela de perda continuava aberta entre a leitura e o PATCH.

    `cdb_apply_operator_mutation` aplica um caminho jsonb sob `for update`, com idempotencia por
    client_ref. Nenhum documento sai daqui.
    """
    _, d = _req("POST", "/rest/v1/rpc/cdb_apply_operator_mutation",
                {"p_type": tipo, "p_payload": payload, "p_actor": actor, "p_client_ref": client_ref})
    return d


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
    # Reaplicar o MESMO sorteio e conclusao, nao sobrescrita.
    #
    # A primeira versao recusava qualquer fase que ja tivesse confrontos. Correto contra
    # sobrescrever um sorteio por outro -- e errado para o caso que aconteceu de verdade: os
    # confrontos foram gravados, o bloco de proveniencia foi para o lugar ERRADO (raiz do estado
    # em vez de dentro da fase, que e onde `drawLifecycle()` le), e a reaplicacao para corrigir
    # ficava barrada pela propria guarda.
    ja_existentes = fases[fase].get("ties") or {}
    if ja_existentes:
        mesmos = set(ja_existentes.keys()) == {t["tieId"] for t in confrontos}
        if not mesmos:
            erros.append(f"a fase '{fase}' ja tem confrontos DIFERENTES — recusando sobrescrever "
                         f"sorteio oficial")
        elif any(t.get("qualifiedTeamId") for t in ja_existentes.values()):
            erros.append(f"a fase '{fase}' ja tem confronto resolvido — reaplicar apagaria "
                         f"resultado oficial")
        else:
            print("  ALREADY_APPLIED — mesmos confrontos ja gravados; completando a proveniencia.")
    for campo in ("source", "fetchedAt", "scheduledAt"):
        if not origem.get(campo):
            erros.append(f"sorteio sem procedencia: falta '{campo}'")

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
    estado["phases"][fase]["ties"] = novos  # so para as invariantes locais abaixo

    # PROVENIENCIA DENTRO DA FASE — e ali que `drawLifecycle()` a le (js/app.js:180:
    # `phase && phase.officialDraw`). A primeira versao gravou na RAIZ do estado; os confrontos
    # entraram, o app continuou exibindo "aguardando a publicacao oficial da CBF", e a pagina
    # publica ficou sem palpite nenhum. Estado correto no banco e invisivel na tela e o mesmo que
    # nao ter feito nada.
    #
    # Os cinco campos sao exigidos por `officialDrawProvenanceIsValid()`; sem os cinco o ciclo
    # cai em INGESTED ("proveniencia incompleta") em vez de LOCKED, e o bracket nao vira oficial.
    # Montado aqui e enviado INTEIRO para set-official-draw; a copia local so alimenta as
    # invariantes impressas abaixo.
    draw_obj = {
        "authority": "CBF",
        "source": origem.get("source"),
        "sourceUrl": origem.get("sourceUrl"),
        "corroboratedBy": origem.get("corroboratedBy"),
        "event": origem.get("event"),
        "scheduledAt": origem["scheduledAt"],
        "ingestedAt": origem.get("fetchedAt"),
        "validatedAt": agora,
        "validatedBy": a.actor,
        "bracketHash": bracket_hash,
        "note": origem.get("note"),
    }
    estado["phases"][fase]["officialDraw"] = draw_obj
    # O bloco antigo na raiz, se existir, sai: duas verdades sobre o mesmo sorteio em lugares
    # diferentes e a divergencia esperando acontecer.
    if isinstance(estado.get("officialDraw"), dict):
        estado["officialDraw"].pop(fase, None)
        if not estado["officialDraw"]:
            estado.pop("officialDraw", None)
    # NAO ha append local de `auditLog` aqui, e a ausencia e deliberada (#413). Desde que
    # `grava_estado()` saiu, o documento lido nunca volta ao servidor: um append local morre na
    # memoria do processo e produz a ILUSAO de trilha. A trilha real e a que o
    # `cdb_apply_operator_mutation` grava a partir de `p_actor`/`p_client_ref`, e ela e VERIFICADA
    # depois da escrita, contra o estado relido -- nao presumida.

    # UMA MUTACAO ESTREITA POR CONFRONTO, e depois a procedencia. Antes disto era um PATCH do
    # documento inteiro: se qualquer outra coisa gravasse entre a leitura e o PATCH, sumia.
    #
    # A ordem importa. Os confrontos entram primeiro e a procedencia por ultimo, porque
    # `enforceDrawLifecycle` no app.js APAGA as ties de uma fase que nao tenha
    # officialDraw.validatedAt -- gravar a procedencia antes das ties abriria uma janela em que a
    # fase esta validada e vazia, e um navegador que lesse nesse instante persistiria o vazio.
    for tid, t in novos.items():
        _rpc("create-tie", {
            "phaseId": fase, "tieId": tid,
            "teamA": t["teamA"], "teamB": t["teamB"],
            "kickoffFirst": (t.get("matches") or {}).get("first", {}).get("kickoff"),
            "kickoffSecond": (t.get("matches") or {}).get("second", {}).get("kickoff"),
        }, f"apply-draw:{fase}:{tid}:{bracket_hash}", a.actor)
    _rpc("set-official-draw", {"phaseId": fase, "officialDraw": draw_obj},
         f"official-draw:{fase}:{bracket_hash}", a.actor)

    depois = le_estado()
    inv_depois = invariantes(depois)
    imprime_invariantes("\n  invariantes depois", inv_depois)

    problemas = compara(inv_antes, inv_depois, permitido={"ties"})
    if (depois["phases"][fase].get("ties") or {}).keys() != novos.keys():
        problemas.append("os confrontos gravados nao batem com os enviados")
    # A trilha e VERIFICADA, nao presumida (#413). O append local que existia aqui morria na memoria
    # do processo; o unico registro real e o que o `cdb_apply_operator_mutation` grava a partir de
    # `p_actor`/`p_client_ref`. Se o servidor aplicou a escrita e nao registrou a trilha, isto e
    # ABORTO: um comando de operador que diz "feito" sem deixar rastro e pior que um que falha.
    refs_trilha = {e.get("clientRef") for e in (depois.get("auditLog") or []) if isinstance(e, dict)}
    faltando_trilha = sorted(f"apply-draw:{fase}:{tid}:{bracket_hash}" for tid in novos
                             if f"apply-draw:{fase}:{tid}:{bracket_hash}" not in refs_trilha)
    if f"official-draw:{fase}:{bracket_hash}" not in refs_trilha:
        faltando_trilha.append(f"official-draw:{fase}:{bracket_hash}")
    if faltando_trilha:
        problemas.append(f"sem trilha de auditoria no servidor para: {faltando_trilha}")
    if problemas:
        print(f"\n  🛑 INVARIANTES VIOLADAS: {problemas}")
        print("     O estado anterior NAO foi restaurado automaticamente — restaure da baseline.")
        print("=" * 70)
        return 2

    print(f"\n  ✓ SORTEIO APLICADO em '{fase}' — {len(novos)} confrontos.")
    print("=" * 70)
    return 0


# ── materialize-derived-phase ──────────────────────────────────────────────────────────────────
#
# Materializa uma fase DERIVADA (semifinal, final) a partir da topologia oficial ja registrada e
# dos vencedores ja persistidos. Issue #410; detectado pela #406 e aberto como #409.
#
# POR QUE UM COMANDO NOVO. Nenhum caminho existente serve, e os dois que chegam perto recusam pelos
# motivos certos: `open-picks` tem guarda `if not ties` e nao materializa nada; `apply-draw` exige
# arquivo de sorteio com procedencia obrigatoria, e a semifinal NAO foi sorteada -- ela vem do
# caminho de chaveamento definido no sorteio das quartas. Usar `apply-draw` aqui exigiria fabricar
# procedencia de um sorteio que nunca existiu.
#
# O QUE ELE NAO FAZ, E ISSO E O PONTO. Nao inventa time (vem de `qualifiedTeamId` persistido), nao
# inventa data (grava `kickoff: null` -- e o caso legitimo da #395), nao inventa local nem
# transmissao, nao manda e-mail, nao recalcula scoring/ranking, nao toca entradas nem pagamentos, e
# NAO avanca `activePhaseId` (isso continua sendo `open-picks`, decisao separada e posterior).
#
# Nao ha gatilho automatico. Automacao e a #411, avaliacao separada, e pode legitimamente terminar
# em "nao automatizar".
FASES_DERIVADAS = {"semifinal": "quartas", "final": "semifinal"}


def _vencedor(tie):
    """O clube que avancou, do `qualifiedTeamId` PERSISTIDO. Nunca inferido de placar."""
    q = tie.get("qualifiedTeamId")
    if q == "A":
        return tie.get("teamA")
    if q == "B":
        return tie.get("teamB")
    return None


def cmd_materialize_derived_phase(a):
    estado = le_estado()
    fases = estado.get("phases") or {}
    fase = a.phase

    print("=" * 70)
    print("  CDB2026 — MATERIALIZAR FASE DERIVADA")
    print("=" * 70)
    print(f"  fase alvo           {fase}")

    if fase not in FASES_DERIVADAS:
        print(f"  🛑 '{fase}' nao e fase derivada. Derivadas: {sorted(FASES_DERIVADAS)}")
        return 2
    anterior = FASES_DERIVADAS[fase]
    if fase not in fases or anterior not in fases:
        print(f"  🛑 fase '{fase}' ou anterior '{anterior}' inexistente no estado.")
        return 2

    # ── GUARDA 1: a fase anterior tem de estar INTEIRAMENTE decidida ─────────────────────────
    ties_ant = (fases[anterior].get("ties") or {})
    if not ties_ant:
        print(f"  🛑 fase anterior '{anterior}' sem confrontos.")
        return 2
    indecisos, sem_placar = [], []
    for tid, t in ties_ant.items():
        if not _vencedor(t):
            indecisos.append(tid)
        for leg, m in (t.get("matches") or {}).items():
            if (m or {}).get("goalsHome") is None:
                sem_placar.append(f"{tid}:{leg}")
    print(f"  fase anterior       {anterior}: {len(ties_ant)} confrontos, "
          f"{len(indecisos)} sem vencedor, {len(sem_placar)} perna(s) sem placar")
    if indecisos or sem_placar:
        print(f"  🛑 fase anterior nao esta inteiramente decidida "
              f"(sem vencedor: {indecisos}; sem placar: {sem_placar})")
        return 2

    # ── GUARDA 2: topologia AUTORITATIVA na fase alvo ────────────────────────────────────────
    topo = fases[fase].get("topology") or {}
    prov = topo.get("provenance") or {}
    slots = topo.get("slots") or {}
    autoritativa = bool(slots) and prov.get("authority") == "CBF" and prov.get("validatedAt")
    print(f"  topologia           {'AUTORITATIVA' if autoritativa else 'AUSENTE/NAO VALIDADA'}"
          f"  (authority={prov.get('authority')}, validatedAt={prov.get('validatedAt')}, slots={len(slots)})")
    if not autoritativa:
        print("  🛑 sem topologia autoritativa nao ha o que materializar — exigi-la seria inventar "
              "chaveamento.")
        return 2

    # ── GUARDA 3: idempotencia ──────────────────────────────────────────────────────────────
    ja = fases[fase].get("ties") or {}
    if ja:
        print(f"  🛑 fase '{fase}' ja tem {len(ja)} confronto(s) materializado(s): "
              f"{sorted(ja)} — nada a fazer (idempotente).")
        return 0

    # ── DERIVACAO: topologia + vencedores persistidos. Nada mais. ───────────────────────────
    novos, erros = {}, []
    for slot_id in sorted(slots):
        slot = slots[slot_id]
        ref_a = (slot.get("sideA") or {}).get("winnerOf")
        ref_b = (slot.get("sideB") or {}).get("winnerOf")
        if not ref_a or not ref_b:
            erros.append(f"{slot_id}: slot sem winnerOf nos dois lados")
            continue
        if ref_a not in ties_ant or ref_b not in ties_ant:
            erros.append(f"{slot_id}: predecessor fora de '{anterior}' ({ref_a} / {ref_b})")
            continue
        a_nome, b_nome = _vencedor(ties_ant[ref_a]), _vencedor(ties_ant[ref_b])
        if not a_nome or not b_nome:
            erros.append(f"{slot_id}: vencedor ausente ({ref_a}->{a_nome} / {ref_b}->{b_nome})")
            continue
        if a_nome == b_nome:
            erros.append(f"{slot_id}: mesmo clube dos dois lados ({a_nome})")
            continue
        tid = _espn_tie_id(a_nome, b_nome)
        if tid in novos:
            erros.append(f"{slot_id}: id de confronto duplicado ({tid})")
            continue
        novos[tid] = {"slotId": slot_id, "teamA": a_nome, "teamB": b_nome}

    print(f"\n  CONFRONTOS DERIVADOS ({len(novos)}):")
    for tid, t in novos.items():
        print(f"    {t['slotId']}  {tid}")
        print(f"        teamA={t['teamA']}  teamB={t['teamB']}")
        print("        kickoff=null  venue=null  city=null   <- sem agenda autoritativa; NAO inventado")
    if erros:
        print(f"\n  🛑 DERIVACAO INCONSISTENTE: {erros}")
        return 2
    if len(novos) != len(slots):
        print(f"\n  🛑 {len(novos)} confrontos para {len(slots)} vagas de topologia.")
        return 2

    inv_antes = invariantes(estado)
    imprime_invariantes("\n  invariantes antes", inv_antes)

    if a.dry_run:
        print(f"\n  DRY RUN — gravaria {len(novos)} confronto(s) em '{fase}'. "
              "Nenhum e-mail, nenhum scoring, nenhuma entrada/pagamento, activePhaseId INTACTO.")
        print("=" * 70)
        return 0

    for tid, t in novos.items():
        # `kickoffFirst`/`kickoffSecond` explicitamente None: a CBF ainda nao publicou a tabela, e
        # materializar nao pode fabricar calendario (#395).
        _rpc("create-tie", {
            "phaseId": fase, "tieId": tid, "teamA": t["teamA"], "teamB": t["teamB"],
            "kickoffFirst": None, "kickoffSecond": None,
        }, f"materialize:{fase}:{tid}", a.actor)
    # NAO ha `estado["auditLog"].append(...)` aqui, e a ausencia e deliberada. Desde que
    # `grava_estado()` saiu, o documento lido nunca volta ao servidor: um append local morre na
    # memoria do processo e produz a ILUSAO de trilha de auditoria. A trilha real e a que o
    # `cdb_apply_operator_mutation` grava a partir de `p_actor`/`p_client_ref` — e ela e VERIFICADA
    # abaixo, contra o estado relido, em vez de assumida.
    # (`cmd_apply_draw` ainda faz o append morto; e defeito pre-existente, fora do escopo do #410 —
    # reportado em separado, nao corrigido em silencio aqui.)
    depois = le_estado()
    inv_depois = invariantes(depois)
    imprime_invariantes("\n  invariantes depois", inv_depois)
    problemas = compara(inv_antes, inv_depois, permitido={"ties"})
    gravados = (depois["phases"][fase].get("ties") or {})
    if set(gravados) != set(novos):
        problemas.append(f"gravados {sorted(gravados)} != derivados {sorted(novos)}")
    for tid in gravados:
        for leg, m in ((gravados[tid].get("matches")) or {}).items():
            if (m or {}).get("kickoff") is not None:
                problemas.append(f"{tid}:{leg} gravou kickoff — agenda nao pode ser inventada")
            if (m or {}).get("venue") is not None:
                problemas.append(f"{tid}:{leg} gravou venue — local nao pode ser inventado")
    if (depois.get("espnSync") or {}).get("activePhaseId") != (estado.get("espnSync") or {}).get("activePhaseId"):
        problemas.append("activePhaseId mudou — materializar nao avanca fase")
    # A trilha tem de EXISTIR no servidor, uma entrada por confronto, com o clientRef que enviamos.
    refs_trilha = {e.get("clientRef") for e in (depois.get("auditLog") or []) if isinstance(e, dict)}
    faltando_trilha = sorted(f"materialize:{fase}:{tid}" for tid in novos
                             if f"materialize:{fase}:{tid}" not in refs_trilha)
    if faltando_trilha:
        problemas.append(f"sem trilha de auditoria no servidor para: {faltando_trilha}")
    if problemas:
        print(f"\n  🛑 INVARIANTES VIOLADAS: {problemas}")
        return 2
    print(f"\n  ✓ MATERIALIZADO: {len(gravados)} confronto(s) em '{fase}', sem agenda inventada.")
    print("    activePhaseId INTACTO — avancar a fase continua sendo `open-picks`, decisao separada.")
    print("=" * 70)
    return 0


# ── backfill-venue ─────────────────────────────────────────────────────────────────────────────
#
# Preenche `venue`/`city` AUSENTES em pernas ja gravadas, a partir do snapshot normalizado da ESPN
# que o repositorio ja versiona (#393). Nao inventa: o unico dado que entra vem do provedor, casado
# por times COM O MANDO NO LADO CERTO e por data com folga.
#
# Por que existe como comando explicito: o #392 resolveu o local do CARD so na leitura, de proposito,
# porque a alternativa reparava producao como efeito colateral de abrir a tela de admin. Renderizar
# nao pode ser o gatilho que migra dado. Entao a correcao do dado ARMAZENADO tem de ser uma operacao
# que alguem manda rodar, com dry-run, e que se recusa a sobrescrever curadoria.
SNAPSHOT_ESPN = "data/espn-normalized.json"


def _slug_time(nome):
    """Mesma normalizacao do `_espn_tie_id`, para casar nome do provedor com nome gravado."""
    import unicodedata
    t = unicodedata.normalize("NFD", str(nome or ""))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")


def _carrega_snapshot():
    caminho = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", SNAPSHOT_ESPN)
    with open(os.path.normpath(caminho), encoding="utf-8") as f:
        return (json.load(f) or {}).get("matches") or []


def _acha_no_snapshot(partidas, home, away, kickoff_iso):
    """Casa UMA partida do provedor. Exige mando no lado certo e data proxima.

    Casar so por conjunto de times acharia a ida quando se procura a volta -- e o local da ida e
    outro estadio. O mando e o que distingue as duas pernas, entao ele NAO e opcional aqui.
    """
    if not kickoff_iso:
        return None
    try:
        alvo = datetime.fromisoformat(str(kickoff_iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    h, a = _slug_time(home), _slug_time(away)
    for m in partidas:
        if _slug_time(m.get("homeTeam")) != h or _slug_time(m.get("awayTeam")) != a:
            continue
        try:
            quando = datetime.fromisoformat(str(m.get("kickoff") or m.get("date") or "").replace("Z", "+00:00"))
        except ValueError:
            continue
        if abs((quando - alvo).total_seconds()) > 12 * 3600:
            continue
        venue = (m.get("venue") or "").strip()
        if not venue:
            return None
        return {"venue": venue, "city": (m.get("city") or "").strip() or None, "espnId": m.get("id")}
    return None


def cmd_backfill_venue(a):
    estado = le_estado()
    fases = estado.get("phases") or {}
    partidas = _carrega_snapshot()

    print("=" * 70)
    print("  CDB2026 — BACKFILL DE LOCAL (venue/city)")
    print("=" * 70)
    print(f"  snapshot            {len(partidas)} partidas do provedor")

    candidatos, sem_provedor, ja_tem = [], [], 0
    for fase_id, fase in sorted(fases.items()):
        for tid, t in sorted((fase.get("ties") or {}).items()):
            for leg, m in sorted((t.get("matches") or {}).items()):
                m = m or {}
                if not m.get("kickoff"):
                    continue                      # sem data nao se espera local (#395)
                if (m.get("venue") or "").strip():
                    ja_tem += 1
                    continue                      # CURADORIA VENCE: nunca sobrescreve
                # mando da volta inverte, mesma regra do app.js e do save-leg
                home = m.get("homeTeam") or (t.get("teamB") if leg == "second" else t.get("teamA"))
                away = m.get("awayTeam") or (t.get("teamA") if leg == "second" else t.get("teamB"))
                achado = _acha_no_snapshot(partidas, home, away, m.get("kickoff"))
                if not achado:
                    sem_provedor.append(f"{fase_id}/{tid}/{leg}")
                    continue
                candidatos.append({"phaseId": fase_id, "tieId": tid, "leg": leg,
                                   "home": home, "away": away, **achado})

    print(f"  pernas com local    {ja_tem} (intocadas)")
    print(f"  sem dado no provedor {len(sem_provedor)}: {sem_provedor if sem_provedor else '-'}")
    print(f"\n  CANDIDATOS ({len(candidatos)}):")
    for c in candidatos:
        print(f"    {c['phaseId']}/{c['tieId']}/{c['leg']}  {c['home']} x {c['away']}")
        print(f"        venue={c['venue']!r} city={c['city']!r}  (espnId={c['espnId']})")

    if not candidatos:
        print("\n  ✓ nada a preencher — todas as pernas com data ja tem local.")
        print("=" * 70)
        return 0

    inv_antes = invariantes(estado)
    imprime_invariantes("\n  invariantes antes", inv_antes)

    if a.dry_run:
        print(f"\n  DRY RUN — preencheria {len(candidatos)} perna(s). Nenhum kickoff, placar, status, "
              "classificacao, entrada ou pagamento e tocado.")
        print("=" * 70)
        return 0

    for c in candidatos:
        _rpc("backfill-venue", {"phaseId": c["phaseId"], "tieId": c["tieId"], "leg": c["leg"],
                                "venue": c["venue"], "city": c["city"]},
             f"backfill-venue:{c['phaseId']}:{c['tieId']}:{c['leg']}", a.actor)

    depois = le_estado()
    inv_depois = invariantes(depois)
    imprime_invariantes("\n  invariantes depois", inv_depois)
    problemas = compara(inv_antes, inv_depois, permitido=set())

    refs_trilha = {e.get("clientRef") for e in (depois.get("auditLog") or []) if isinstance(e, dict)}
    for c in candidatos:
        ref = f"backfill-venue:{c['phaseId']}:{c['tieId']}:{c['leg']}"
        if ref not in refs_trilha:
            problemas.append(f"sem trilha de auditoria no servidor para: {ref}")
        d = ((depois["phases"][c["phaseId"]]["ties"][c["tieId"]].get("matches") or {}).get(c["leg"]) or {})
        o = ((estado["phases"][c["phaseId"]]["ties"][c["tieId"]].get("matches") or {}).get(c["leg"]) or {})
        if (d.get("venue") or "") != c["venue"]:
            problemas.append(f"{ref}: venue nao gravou")
        for campo in ("kickoff", "goalsHome", "goalsAway", "status", "resultSource", "lockedBy"):
            if d.get(campo) != o.get(campo):
                problemas.append(f"{ref}: {campo} MUDOU ({o.get(campo)!r} -> {d.get(campo)!r})")
        tie_d = depois["phases"][c["phaseId"]]["ties"][c["tieId"]]
        tie_o = estado["phases"][c["phaseId"]]["ties"][c["tieId"]]
        if tie_d.get("qualifiedTeamId") != tie_o.get("qualifiedTeamId"):
            problemas.append(f"{c['tieId']}: qualifiedTeamId MUDOU")
    if problemas:
        print(f"\n  🛑 INVARIANTES VIOLADAS: {problemas}")
        return 2
    print(f"\n  ✓ LOCAL PREENCHIDO em {len(candidatos)} perna(s). Nada mais foi tocado.")
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
    print(f"  espnSync.activePhaseId atual {(estado.get('espnSync') or {}).get('activePhaseId')}"
          f"   <- e ESTE que o app le")
    if not ties:
        print("  🛑 fase sem confrontos — abrir palpites agora mostraria tela vazia.")
        return 1

    inv_antes = invariantes(estado)
    if a.dry_run:
        print(f"\n  DRY RUN — espnSync.activePhaseId e activePhase passariam a ser {a.phase}")
        print("=" * 70)
        return 0

    agora = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    # O CAMPO QUE O APP REALMENTE LE (2026-08-11).
    #
    # `entryCutoffMs()` no js/app.js le `s.espnSync.activePhaseId`, NAO `s.activePhase`. A primeira
    # versao deste comando gravou so `activePhase`: o banco passou a dizer "quartas", o app
    # continuou em "oitavas" -- cujo prazo venceu em 01/08 -- e portanto tratava a entrada como
    # ENCERRADA. Os quatro confrontos estavam em producao, o formulario existia no DOM, e nenhum
    # participante via nada.
    #
    # Os dois campos sao gravados: `espnSync.activePhaseId` porque e o que decide, e `activePhase`
    # porque ja existe no documento e deixa-lo divergente e a proxima armadilha.
    estado.setdefault("espnSync", {})["activePhaseId"] = a.phase
    estado["activePhase"] = a.phase
    # Sem append local de `auditLog` (#413) -- ele nunca chegou ao servidor. A trilha real e
    # verificada abaixo, pelo `clientRef` que este comando envia.
    # `set-active-phase` grava os DOIS campos no servidor desde 028 -- `activePhase` e
    # `espnSync.activePhaseId`. Era exatamente a divergencia que este arquivo documenta: o banco
    # dizia "quartas", o app continuava em "oitavas" e ninguem via os palpites abertos.
    _rpc("set-active-phase", {"phaseId": a.phase}, f"open-picks:{a.phase}", a.actor)

    depois = le_estado()
    problemas = compara(inv_antes, invariantes(depois), permitido=set())
    # Mesma regra do #413: a trilha do servidor tem de existir, com o clientRef que enviamos.
    refs_trilha = {e.get("clientRef") for e in (depois.get("auditLog") or []) if isinstance(e, dict)}
    if f"open-picks:{a.phase}" not in refs_trilha:
        problemas.append(f"sem trilha de auditoria no servidor para: open-picks:{a.phase}")
    if depois.get("activePhase") != a.phase:
        problemas.append("activePhase nao gravou")
    if (depois.get("espnSync") or {}).get("activePhaseId") != a.phase:
        problemas.append("espnSync.activePhaseId nao gravou — o app continuaria na fase anterior")
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

    b = sub.add_parser("backfill-venue")
    b.add_argument("--actor", default="operator-cli")
    b.add_argument("--dry-run", action="store_true"); b.add_argument("--apply", action="store_true")

    m = sub.add_parser("materialize-derived-phase")
    m.add_argument("--phase", required=True)
    m.add_argument("--actor", default="operator-cli")
    m.add_argument("--dry-run", action="store_true"); m.add_argument("--apply", action="store_true")

    a = p.parse_args()
    # `materialize-derived-phase` entra nesta lista, e a entrada e a parte que importa: sem ela,
    # rodar o comando sem bandeira nenhuma cai em `dry_run=False` e GRAVA em silencio. Um default
    # que escreve e o oposto de um default seguro -- e este comando grava chaveamento de torneio.
    # Nao ha default: ou se diz `--dry-run` ou se diz `--apply`.
    if a.cmd in ("apply-draw", "open-picks", "materialize-derived-phase", "backfill-venue") and not (a.dry_run or a.apply):
        p.error("escolha --dry-run ou --apply")
    return {"snapshot": cmd_snapshot, "apply-draw": cmd_apply_draw,
            "open-picks": cmd_open_picks,
            "materialize-derived-phase": cmd_materialize_derived_phase,
            "backfill-venue": cmd_backfill_venue}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
