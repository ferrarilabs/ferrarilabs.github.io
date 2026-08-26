#!/usr/bin/env python3
"""recover_result_email.py — reenvio de UMA notificação de resultado, com ALVO EXPLÍCITO.

─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────────────────────────

Em 2026-08-26 a perna `quartas:espn-atletico-mg_cruzeiro:first` foi gravada e ninguém foi avisado
(#347). Corrigido o remetente, sobrou a pergunta operacional: como entregar aquela notificação
perdida, uma única vez, sem arriscar entregar a errada?

O modo padrão do `send_result_email.py` **não serve** para isso. Ele escolhe *a última perna com
resultado*, varrendo fases→confrontos→jogos, e não aceita alvo. Com outras quartas já jogadas, ele
mandaria e-mail sobre **outro jogo** — e consumiria a identidade de ledger daquele outro jogo junto.

Então aqui o alvo é **obrigatório e explícito**: fase, confronto, perna e o placar esperado. Nada é
inferido, nada tem default, e não existe fallback. Se qualquer um deles não bater com o que está
gravado em produção, o processo recusa.

─── O QUE ELE SE RECUSA A FAZER ────────────────────────────────────────────────────────────────

Não grava resultado. Não toca palpite, scoring, ranking, pagamento, schema, RLS ou segredo. Não
alarga o conjunto de destinatários. Não reenvia para quem o ledger já registra como entregue. E não
envia nada sem `--send` MAIS a autorização explícita que o próprio `send_email()` já exige.

Diante de estado ambíguo — ledger ilegível, linha em `processing`, entrega parcial anterior — ele
**para**. "Não consegui decidir" nunca vira "provavelmente pode mandar": foi exatamente essa
confusão que produziu a duplicata da #221, quando a rodada 23 saiu quatro vezes.

─── PRIVACIDADE DO LOG ─────────────────────────────────────────────────────────────────────────

Nenhum endereço de participante é impresso, nem em sucesso nem em erro. O log de uma execução
destas vira evidência lida em Issue e em painel do Actions; ele carrega CONTAGENS e o `entry_ref`
(id da entrada, que não é PII), nunca o endereço. É por isso que o laço de envio vive aqui e não
reaproveita `_send_to_all()`, que imprime o destinatário a cada linha.

Uso:
    python3 recover_result_email.py --phase quartas --tie <tieId> --leg first --expect 1-1 --preflight
    python3 recover_result_email.py --phase quartas --tie <tieId> --leg first --expect 1-1 --send
"""
import argparse
import importlib.util
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
sys.path.insert(0, str(AQUI.parent.parent / "shared" / "scripts"))


def _carregar_sender():
    """Importa o remetente canônico. Nada é reimplementado aqui: estado, template, destinatários e
    transporte são os MESMOS que o `--auto` usa — senão a recuperação entregaria outra coisa."""
    spec = importlib.util.spec_from_file_location("sender_canonico", AQUI / "send_result_email.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── Estados do alvo ──────────────────────────────────────────────────────────────────────────
READY = "READY_FOR_EXPLICIT_RECOVERY"
ALREADY = "ALREADY_DELIVERED"
UNCERTAIN = "UNCERTAIN"
NOT_READY = "NOT_READY"

# `sent` é entrega registrada.
#
# TUDO O MAIS É AMBÍGUO, inclusive `pending` — e isso foi aprendido caro, na recuperação de
# 2026-08-26. `reserve()` cria as linhas ANTES de chamar o provedor, então uma linha `pending` não
# significa "não foi entregue": significa "reservada, e não sei o que aconteceu depois". Naquela
# execução os 12 e-mails saíram (o provedor devolveu OK para todos) e as 12 linhas ficaram em
# `pending`, porque `mark_sent()` não consegue marcar nada (ver a Issue de `bolao_notif_jobs`:
# passa hash de conteúdo onde a RPC quer o UUID do job, e a RPC só atualiza linha em `processing`).
#
# Se `pending` contasse como recuperável, a execução seguinte reenviaria para os mesmos 12. É
# exatamente a duplicata da #221, montada de novo por outro caminho. Então `pending` BLOQUEIA.
#
# O custo é real e aceito: uma reserva órfã de uma tentativa que de fato nunca enviou também
# bloqueia, e destravá-la exige decisão humana explícita. Bloquear a mais é recuperável; entregar
# duas vezes ao participante não é.
_SENT = {"sent"}
# Continuam num balde PROPRIO para a contagem do preflight ficar legivel (`LEDGER_PENDING_COUNT`
# diz quantas reservas existem). Legivel, mas nao permissivo: quem decide e o status abaixo, e
# qualquer linha neste balde BLOQUEIA.
_PENDENTE = {"pending", "failed_retryable"}


def classificar_ledger(linhas, prefixo):
    """Conta, para o alvo, quantas linhas estão entregues / pendentes / ambíguas.

    `linhas` são `(idempotency_key, status)` do pool inteiro; o filtro é por PREFIXO exato da chave
    de idempotência, que já embute pool, tipo de evento e `fase:confronto:perna`. Prefixo exato é o
    que impede a identidade de escorregar para outro confronto das quartas.
    """
    sent, pend, incerto = set(), set(), set()
    for chave, status in linhas:
        if not chave.startswith(prefixo):
            continue
        ref = chave[len(prefixo):]
        if not ref or ":" in ref:      # a chave termina em `:<entry_ref>`; nada além disso
            incerto.add(chave)
            continue
        s = (status or "").strip().lower()
        if s in _SENT:
            sent.add(ref)
        elif s in _PENDENTE:
            pend.add(ref)
        else:
            incerto.add(ref)
    return sent, pend, incerto


def montar_assunto(S, tie, leg, gh, ga):
    """O MESMO assunto que o `--auto` teria produzido para esta perna.

    Não é o do modo padrão: aquele passa pela política de assunto, ganha o ícone de futebol e
    NÃO traz o placar. Entregar a recuperação com um assunto diferente do que a notificação
    original teria trazido faria o participante receber outra coisa; `test_recover_result_email.py`
    prende os dois juntos comparando as duas construções.
    """
    home = tie["teamB"] if leg == "second" else tie["teamA"]
    away = tie["teamA"] if leg == "second" else tie["teamB"]
    return f"Resultado Parcial — {tie['teamA']} × {tie['teamB']}: {home} {gh}–{ga} {away}"


def preflight(S, phase_id, tie_id, leg, esperado, ledger=None, state=None):
    """Só LEITURA. Devolve um dicionário de evidência agregada — nunca endereços."""
    ev = {"TARGET_PHASE": phase_id, "TARGET_TIE": tie_id, "TARGET_LEG": leg,
          "RESULT": None, "EXPECTED_RECIPIENT_COUNT": 0, "RESOLVED_RECIPIENT_COUNT": 0,
          "LEDGER_SENT_COUNT": 0, "LEDGER_PENDING_COUNT": 0, "LEDGER_UNCERTAIN_COUNT": 0,
          "WOULD_SEND_COUNT": 0, "TARGET_STATUS": NOT_READY, "MOTIVO": ""}

    if phase_id not in S.PHASE_BY_ID:
        ev["MOTIVO"] = f"fase inexistente: {phase_id}"
        return ev, None, None
    if leg not in S.legs_for_format(S.PHASE_BY_ID[phase_id]["format"]):
        ev["MOTIVO"] = f"perna invalida para o formato desta fase: {leg}"
        return ev, None, None

    state = state if state is not None else S.sb_fetch()
    ties = (state.get("phases", {}).get(phase_id, {}) or {}).get("ties", {}) or {}
    if tie_id not in ties:
        ev["MOTIVO"] = f"confronto inexistente na fase: {tie_id}"
        return ev, None, None
    tie = ties[tie_id]
    jogo = (tie.get("matches") or {}).get(leg) or {}
    gh, ga = jogo.get("goalsHome"), jogo.get("goalsAway")
    if gh is None or ga is None:
        ev["MOTIVO"] = "a perna alvo nao tem resultado gravado — recuperacao so reenvia o que ja existe"
        return ev, None, None
    ev["RESULT"] = f"{gh}-{ga}"

    if esperado is not None and ev["RESULT"] != esperado:
        # Guarda de alvo, não de estilo: se o placar gravado mudou desde que o operador montou o
        # comando, o alvo deixou de ser o que ele revisou.
        ev["MOTIVO"] = f"placar gravado ({ev['RESULT']}) difere do esperado ({esperado})"
        return ev, None, None

    destinatarios = S._build_recipients(state)
    ev["EXPECTED_RECIPIENT_COUNT"] = len(destinatarios)
    refs = {}
    for addr in destinatarios.values():
        r = S._entry_ref_for(state, addr)
        if r:
            refs[r] = addr
    ev["RESOLVED_RECIPIENT_COUNT"] = len(refs)

    reg = ledger if ledger is not None else _ledger_padrao()
    if reg is None:
        ev["TARGET_STATUS"] = UNCERTAIN
        ev["MOTIVO"] = "ledger nao pode ser construido — estado de entrega indecidivel"
        return ev, tie, None
    try:
        linhas = reg.status_rows()
    except Exception as ex:  # noqa: BLE001 — ilegível NUNCA vira "pode mandar"
        ev["TARGET_STATUS"] = UNCERTAIN
        ev["MOTIVO"] = f"ledger ilegivel: {type(ex).__name__}"
        return ev, tie, None

    from result_email_ledger import idempotency_key
    prefixo = idempotency_key(phase_id, tie_id, leg, "")
    sent, pend, incerto = classificar_ledger(linhas, prefixo)
    ev["LEDGER_SENT_COUNT"] = len(sent)
    ev["LEDGER_PENDING_COUNT"] = len(pend)
    ev["LEDGER_UNCERTAIN_COUNT"] = len(incerto)

    faltando = [r for r in refs if r not in sent]
    ev["WOULD_SEND_COUNT"] = len(faltando)

    if incerto or pend:
        ev["TARGET_STATUS"] = UNCERTAIN
        ev["MOTIVO"] = ("ha linhas de ledger para este alvo em estado nao conclusivo — reserva sem "
                        "confirmacao NAO prova ausencia de entrega")
    elif sent:
        ev["TARGET_STATUS"] = ALREADY
        ev["MOTIVO"] = "ja existe entrega registrada para este alvo"
    elif ev["EXPECTED_RECIPIENT_COUNT"] != ev["RESOLVED_RECIPIENT_COUNT"]:
        ev["MOTIVO"] = "ha destinatario sem entry_ref resolvivel — o ledger nao poderia registrar todos"
    elif ev["WOULD_SEND_COUNT"] != ev["EXPECTED_RECIPIENT_COUNT"]:
        ev["MOTIVO"] = "o conjunto a enviar nao cobre todos os esperados"
    elif ev["EXPECTED_RECIPIENT_COUNT"] == 0:
        ev["MOTIVO"] = "nenhum destinatario resolvido"
    else:
        ev["TARGET_STATUS"] = READY
    return ev, tie, refs


def _ledger_padrao():
    try:
        from result_email_ledger import SupabaseResultEmailLedger, POOL_ID

        class _Adaptador(SupabaseResultEmailLedger):
            def status_rows(self):
                linhas = self._rpc("bolao_notif_status_by_pool", {"p_pool_id": POOL_ID}) or []
                return [(r.get("idempotency_key") or "", r.get("status") or "") for r in linhas]

        return _Adaptador()
    except Exception:  # noqa: BLE001
        return None


def imprimir(ev):
    print("=" * 66)
    print("  PREFLIGHT DE RECUPERACAO — SOMENTE LEITURA")
    print("=" * 66)
    for k in ("TARGET_PHASE", "TARGET_TIE", "TARGET_LEG", "RESULT",
              "EXPECTED_RECIPIENT_COUNT", "RESOLVED_RECIPIENT_COUNT",
              "LEDGER_SENT_COUNT", "LEDGER_PENDING_COUNT", "LEDGER_UNCERTAIN_COUNT",
              "WOULD_SEND_COUNT", "TARGET_STATUS"):
        print(f"  {k} = {ev[k]}")
    if ev.get("MOTIVO"):
        print(f"  MOTIVO = {ev['MOTIVO']}")
    print("=" * 66)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Recuperacao de UMA notificacao de resultado, alvo explicito.")
    ap.add_argument("--phase", required=True)
    ap.add_argument("--tie", required=True)
    ap.add_argument("--leg", required=True, choices=["first", "second"])
    ap.add_argument("--expect", required=True, help="placar gravado esperado, ex.: 1-1")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--preflight", action="store_true")
    g.add_argument("--send", action="store_true")
    a = ap.parse_args(argv)

    S = _carregar_sender()
    ev, tie, refs = preflight(S, a.phase, a.tie, a.leg, a.expect)
    imprimir(ev)

    if a.preflight:
        return 0 if ev["TARGET_STATUS"] == READY else 3

    if ev["TARGET_STATUS"] != READY:
        print(f"\n  🛑 RECUSADO — alvo em {ev['TARGET_STATUS']}. Nenhuma mensagem enviada.")
        return 3

    state = S.sb_fetch()
    gh, ga = ev["RESULT"].split("-")
    assunto = montar_assunto(S, tie, a.leg, gh, ga)
    html = S.build_html(state, a.phase, a.tie, a.leg, tie_just_decided=False)
    print(f"\n  assunto: {assunto}")

    reg = _ledger_padrao()
    reg.reserve(a.phase, a.tie, a.leg, sorted(refs))

    enviados, erros = 0, 0
    for ref in sorted(refs):
        addr = refs[ref]
        try:
            status = S.send_email(addr, assunto, html)
            enviados += 1
            reg.mark_sent(a.phase, a.tie, a.leg, ref, status)
            print(f"  OK entry_ref={ref}")      # nunca o endereco
        except Exception as ex:  # noqa: BLE001
            erros += 1
            print(f"  ERR entry_ref={ref}: {type(ex).__name__}")
    print(f"\n  → enviados={enviados} erros={erros} de {len(refs)}")
    return 0 if erros == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
