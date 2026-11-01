#!/usr/bin/env python3
"""apply_correction.py — aplica um plano de correcao de resultado/horario do CDB2026, sem e-mail.

POR QUE EXISTE (2026-11-01)
O unico caminho manual de correcao era o modo `--update` do cdb2026_result_emails.yml, que grava
e LOGO EM SEGUIDA envia o e-mail de resultado a todos. Corrigir a semifinal (placar da ida gravado
na volta) por ali repetiria o erro com um segundo e-mail.

Este script so grava. O plano e um JSON versionado (bolao/cdb2026/data/corrections/), revisado em
PR antes de rodar. Cada operacao:
  1. so e aplicada se a perna estiver EXATAMENTE em `expectBefore` (senao aborta tudo, antes de
     gravar qualquer coisa);
  2. vai pela mesma mutacao estreita do servidor (cdb_apply_operator_mutation);
  3. e conferida RELENDO o servidor contra `expectAfter`.
Uma operacao ja aplicada (perna ja em `expectAfter`) e pulada, entao rodar duas vezes e seguro.

Uso: apply_correction.py <plano.json> [--apply]   (sem --apply: so mostra o antes/depois)
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
os.environ.pop("BOLAO_ALLOW_REAL_SEND", None)  # fail-closed: nada aqui pode enviar e-mail
import send_result_email as S  # noqa: E402

OPS = {"clear-leg", "save-leg", "kickoff"}


def _perna(state, op):
    tie = (state.get("phases", {}).get(op["phaseId"], {}).get("ties", {}) or {}).get(op["tieId"])
    if tie is None:
        raise SystemExit(f"🛑 confronto {op['phaseId']}/{op['tieId']} nao existe")
    return (tie.get("matches", {}) or {}).get(op["leg"]) or {}


def _bate(perna, esperado):
    return [f"{k}: banco={perna.get(k)!r} esperado={v!r}" for k, v in esperado.items() if perna.get(k) != v]


def _ref(plano, i, op):
    return f"cdb-correction:{plano['id']}:{i}:{op['op']}:{op['phaseId']}:{op['tieId']}:{op['leg']}"


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        raise SystemExit(__doc__)
    plano = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    aplicar = "--apply" in args
    os.environ.setdefault("CDB_ACTOR", f"operator:apply_correction:{plano['id']}")

    for op in plano["operations"]:
        if op["op"] not in OPS or op["leg"] not in ("first", "second", "single"):
            raise SystemExit(f"🛑 operacao invalida: {op}")

    estado = S.sb_fetch()
    pendentes = []
    print(f"Plano {plano['id']} — {'APLICAR' if aplicar else 'DRY-RUN'}")
    for i, op in enumerate(plano["operations"]):
        perna = _perna(estado, op)
        alvo = f"[{i}] {op['op']:<9} {op['phaseId']}/{op['tieId']}/{op['leg']}"
        if not _bate(perna, op["expectAfter"]):
            print(f"{alvo}: ja aplicada — pula")
            continue
        diverge = _bate(perna, op["expectBefore"])
        if diverge:
            # Nada foi gravado ainda: o banco nao esta no estado que o plano revisado descreve.
            raise SystemExit(f"🛑 {alvo}: banco fora do esperado, NADA gravado:\n  " + "\n  ".join(diverge))
        print(f"{alvo}: antes {json.dumps({k: perna.get(k) for k in op['expectAfter']}, ensure_ascii=False)}"
              f" -> depois {json.dumps(op['expectAfter'], ensure_ascii=False)}")
        pendentes.append((i, op))

    if not aplicar:
        print(f"\nDry-run: {len(pendentes)} operacao(oes) seriam aplicadas. Nada gravado.")
        return
    for i, op in pendentes:
        ref = _ref(plano, i, op)
        if op["op"] == "clear-leg":
            payload = {"phaseId": op["phaseId"], "tieId": op["tieId"], "leg": op["leg"]}
        elif op["op"] == "save-leg":
            payload = {"phaseId": op["phaseId"], "tieId": op["tieId"], "leg": op["leg"],
                       "goalsHome": int(op["goalsHome"]), "goalsAway": int(op["goalsAway"]),
                       "resultSource": "admin"}
        else:
            payload = {"phaseId": op["phaseId"], "tieId": op["tieId"], "leg": op["leg"], "kickoff": op["kickoff"]}
        status, resp = S._sb_rpc(op["op"] if op["op"] != "kickoff" else "backfill-kickoff", payload, ref)
        print(f"[{i}] {op['op']}: HTTP {status} {json.dumps(resp, ensure_ascii=False) if resp is not None else ''}")
        if isinstance(resp, dict) and resp.get("applied") is False:
            # Ref ja visto pelo servidor: a operacao NAO foi aplicada agora. Para em vez de seguir.
            raise SystemExit(f"🛑 [{i}] o servidor recusou como repetida ({resp.get('reason')}); confira o auditLog")

    estado = S.sb_fetch()
    erros = []
    for i, op in enumerate(plano["operations"]):
        erros += [f"[{i}] {d}" for d in _bate(_perna(estado, op), op["expectAfter"])]
    if erros:
        raise SystemExit("🛑 estado depois da gravacao NAO bate com o plano:\n  " + "\n  ".join(erros))
    print(f"\n✓ {len(pendentes)} operacao(oes) aplicadas e conferidas no servidor. Nenhum e-mail enviado.")


if __name__ == "__main__":
    main()
