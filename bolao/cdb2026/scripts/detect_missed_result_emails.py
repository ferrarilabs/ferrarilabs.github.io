#!/usr/bin/env python3
"""
DETECTOR DE E-MAIL DE RESULTADO PERDIDO — CDB2026, Issue #180.

Responde a pergunta que o painel do Actions não consegue responder hoje:

    "terminou uma perna e o e-mail de resultado NÃO saiu?"

─── OS TRÊS ESTADOS, E POR QUE O TERCEIRO EXISTE ────────────────────────────────────────────────

    esperado + entrega no ledger      -> HEALTHY
    esperado + entrega ausente        -> GAP
    ledger ilegível / estado indisponível -> UNKNOWN

**UNKNOWN NUNCA vira GAP.** Essa é a propriedade que decide se este detector sobrevive. Um monitor
que não distingue "não há registro" de "não consegui ler" vira gerador de alarme falso durante
exatamente a queda que importa — e um alarme que grita durante toda queda é silenciado, e aí o
defeito real volta a passar. Foi assim que o HIST-037 sobreviveu.

Consequência prática: perda de banco/rede sai como UNKNOWN, o processo sai com código != 0 para o
Actions mostrar a falha do CHECK, e **nenhuma lacuna é afirmada**.

─── PRE_LEDGER: A PARTE QUE NÃO SE INVENTA ──────────────────────────────────────────────────────

Perna cujo resultado é anterior a `LEDGER_ADOPTED_AT` não tem registro porque o registro não
existia. Ela sai como PRE_LEDGER — nem saudável, nem lacuna. Fabricar entrega para ela seria criar
um registro capaz de **suprimir um envio futuro legítimo** sem nenhuma evidência autoritativa, e
reenviar só para "estabelecer estado" mandaria e-mail real a participante real. As duas coisas são
proibidas; a terceira opção honesta é declarar a janela como fora de escopo.

─── ESTE DETECTOR NÃO ENVIA NADA ────────────────────────────────────────────────────────────────

Ele não envia e-mail, não enfileira, não reenvia e não toca no caminho de envio. O sinal é o
resultado do workflow — GitHub-native, como a autorização determina.

Uso:  python3 detect_missed_result_emails.py [--json]
Saída: 0 = tudo HEALTHY/PRE_LEDGER · 2 = GAP encontrado · 3 = UNKNOWN (não foi possível decidir)
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

from result_email_ledger import (GRACE_HOURS, LEDGER_ADOPTED_AT, LedgerUnavailable,
                                 SupabaseResultEmailLedger, entity_id)

HEALTHY, GAP, UNKNOWN, PRE_LEDGER = "HEALTHY", "GAP", "UNKNOWN", "PRE_LEDGER"
EXIT_OK, EXIT_GAP, EXIT_UNKNOWN = 0, 2, 3


def _parse_iso(v):
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def expected_emails(state, *, now=None, grace_hours=GRACE_HOURS):
    """Pernas que JÁ DEVERIAM ter gerado e-mail: resultado salvo e folga vencida.

    A âncora é o kickoff da perna, não o instante em que o resultado foi gravado: o estado não
    carrega esse instante, e o kickoff é o único tempo autoritativo que existe por perna. Uma perna
    sem kickoff conhecido é DELIBERADAMENTE ignorada em vez de chutada — não dá para dizer que um
    e-mail está atrasado sem saber de quando.
    """
    now = now or datetime.now(timezone.utc)
    limite = now - timedelta(hours=grace_hours)
    out = []
    for phase_id, phase in (state.get("phases") or {}).items():
        for tie_id, tie in (phase.get("ties") or {}).items():
            for leg, m in (tie.get("matches") or {}).items():
                if not isinstance(m, dict) or m.get("goalsHome") is None:
                    continue  # sem resultado salvo -> nada era esperado
                ko = _parse_iso(m.get("kickoff"))
                if ko is None:
                    continue  # sem âncora temporal -> não se afirma atraso
                if ko > limite:
                    continue  # dentro da folga -> ainda não é esperado
                out.append({"phaseId": phase_id, "tieId": tie_id, "leg": leg,
                            "entityId": entity_id(phase_id, tie_id, leg),
                            "kickoff": m.get("kickoff")})
    return sorted(out, key=lambda x: (x["kickoff"], x["entityId"]))


def classify(expected, delivered_entity_ids, *, adopted_at=LEDGER_ADOPTED_AT):
    """Classifica cada esperado. `delivered_entity_ids=None` significa LEDGER ILEGÍVEL -> UNKNOWN."""
    corte = _parse_iso(adopted_at)
    achados = []
    for e in expected:
        if delivered_entity_ids is None:
            achados.append({**e, "state": UNKNOWN,
                            "reason": "o ledger não pôde ser lido; nenhuma conclusão sobre entrega"})
            continue
        ko = _parse_iso(e.get("kickoff"))
        if corte and ko and ko < corte:
            achados.append({**e, "state": PRE_LEDGER,
                            "reason": f"perna anterior à adoção do ledger ({adopted_at}); fora de escopo"})
            continue
        if e["entityId"] in delivered_entity_ids:
            achados.append({**e, "state": HEALTHY, "reason": "entrega registrada no ledger"})
        else:
            achados.append({**e, "state": GAP,
                            "reason": "resultado salvo e folga vencida, sem nenhuma entrega registrada"})
    return achados


def finding_id(achado):
    """Identidade determinística de uma lacuna: fase/confronto/perna.

    NÃO inclui hora, contagem nem tentativa — se incluísse, a mesma lacuna persistente geraria uma
    identidade nova a cada execução e o sinal viraria uma enxurrada. Deduplicar é o que mantém uma
    lacuna que dura três dias como UM assunto.
    """
    return f"cdb2026:result-email-gap:{achado['entityId']}"


def dedupe(achados):
    vistos, saida = set(), []
    for a in achados:
        fid = finding_id(a)
        if fid in vistos:
            continue
        vistos.add(fid)
        saida.append({**a, "findingId": fid})
    return saida


def summarize(achados):
    contagem = {HEALTHY: 0, GAP: 0, UNKNOWN: 0, PRE_LEDGER: 0}
    for a in achados:
        contagem[a["state"]] = contagem.get(a["state"], 0) + 1
    if contagem[UNKNOWN]:
        return UNKNOWN, contagem, EXIT_UNKNOWN
    if contagem[GAP]:
        return GAP, contagem, EXIT_GAP
    return HEALTHY, contagem, EXIT_OK


def run(state_loader, ledger, *, now=None):
    try:
        state = state_loader()
    except Exception as ex:  # noqa: BLE001 — estado indisponível é UNKNOWN, nunca GAP
        return {"overall": UNKNOWN, "counts": {UNKNOWN: 1}, "findings": [],
                "note": f"estado não pôde ser lido: {ex}"}, EXIT_UNKNOWN

    esperados = expected_emails(state, now=now)
    try:
        entregues = ledger.delivered_entity_ids(LEDGER_ADOPTED_AT)
    except LedgerUnavailable as ex:
        entregues = None
        nota = f"ledger não pôde ser lido: {ex}"
    else:
        nota = None

    achados = dedupe(classify(esperados, entregues))
    overall, contagem, code = summarize(achados)
    return {"overall": overall, "counts": contagem,
            "findings": [a for a in achados if a["state"] in (GAP, UNKNOWN)],
            "note": nota}, code


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    sys.path.insert(0, __file__.rsplit("/", 1)[0])
    import send_result_email as sender  # importado tarde: só o leitor de estado é usado

    rel, code = run(sender.sb_fetch, SupabaseResultEmailLedger())
    if args.json:
        print(json.dumps(rel, indent=2, ensure_ascii=False))
    else:
        print(f"\nCDB2026 — e-mail de resultado: {rel['overall']}")
        print(f"  {rel['counts']}")
        if rel.get("note"):
            print(f"  nota: {rel['note']}")
        for a in rel["findings"]:
            print(f"  [{a['state']}] {a['findingId']} — {a['reason']}")
        if rel["overall"] == UNKNOWN:
            print("\n  UNKNOWN NÃO é lacuna. Nada foi afirmado sobre entrega.")
    return code


if __name__ == "__main__":
    sys.exit(main())
