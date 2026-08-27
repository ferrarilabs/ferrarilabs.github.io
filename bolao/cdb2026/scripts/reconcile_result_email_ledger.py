#!/usr/bin/env python3
"""reconcile_result_email_ledger.py — reconciliação de entregas HISTÓRICAS já ocorridas (#352).

─── O QUE ISTO É, E O QUE NÃO É ────────────────────────────────────────────────────────────────

Isto NÃO envia e-mail. Não importa, não referencia e não alcança nenhum caminho de provedor — não
há `send_email`, não há `_send_to_all`, não há `BOLAO_ALLOW_REAL_SEND`. `test_reconcile_ledger.py`
prova isso lendo este arquivo, para que a garantia não dependa de ninguém lembrar.

O que ele faz é estreito: pegar linhas de ledger que ficaram em `pending` por causa de um defeito
do adaptador (#352), quando a entrega ao participante DE FATO aconteceu, e convertê-las em
evidência canônica de entrega — sem inventar nada que não se saiba.

─── POR QUE A ENTREGA É TRATADA COMO FATO ──────────────────────────────────────────────────────

Não é o `pending` que prova entrega — `pending` não prova nada, e é justamente por isso que a
ferramenta de recuperação BLOQUEIA nesse estado. A prova vem de fora do ledger: a execução
autorizada de envio, no runner confiável, que registrou `enviados=12 erros=0 de 12`.

Essa evidência é passada explicitamente (`--source-run`, `--delivered-count`, `--error-count`) e
CONFERIDA contra o alvo. Sem ela, a ferramenta recusa. Reconciliar sem evidência externa seria
exatamente o que este repositório chama de fabricar registro.

─── O QUE NÃO SE SABE, E FICA DITO ─────────────────────────────────────────────────────────────

`provider_message_id` por destinatário é IRRECUPERÁVEL: a execução autorizada registrou só
`entry_ref`, de propósito, para não colocar endereço em log. Fica `NULL`, e a procedência grava
`providerMessageId: UNRECOVERABLE`. Inventar um id seria fabricar evidência de provedor.

`sent_at` recebe o instante da execução autorizada, informado por quem opera — nunca `now()`, que
seria a hora da reconciliação apresentada como hora da entrega.

Uso:
    python3 reconcile_result_email_ledger.py --phase quartas --tie <tieId> --leg first \\
        --expect-result 1-1 --source-run <runId> --delivered-at <ISO> [--apply]
"""
import argparse
import importlib.util
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

# Identidade da operação. Vai para a procedência de cada linha reconciliada.
RECONCILIATION_REASON = "historical-ledger-defect-352"
RPC_RECONCILE = "reconcile_bolao_notif_historical_delivery"

READY = "READY_FOR_RECONCILIATION"
ALREADY = "ALREADY_RECONCILED"
BLOCKED = "BLOCKED"


def _ledger_mod():
    spec = importlib.util.spec_from_file_location("led_canon", AQUI / "result_email_ledger.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def classificar_linhas(linhas, prefixo):
    """Separa as linhas do alvo por estado. `linhas` são `(idempotency_key, status)`."""
    pend, sent, outros, refs = [], [], [], []
    for chave, status in linhas:
        if not chave.startswith(prefixo):
            continue
        ref = chave[len(prefixo):]
        if not ref or ":" in ref:
            outros.append(chave)          # chave malformada nunca é contada como linha boa
            continue
        refs.append(ref)
        s = (status or "").strip().lower()
        (pend if s == "pending" else sent if s == "sent" else outros).append(ref)
    return pend, sent, outros, refs


def preflight(L, phase_id, tie_id, leg, esperado, evidencia, ledger, state, por_entidade=None):
    """Só LEITURA. Devolve evidência agregada — nunca endereço, nome, palpite ou payload cru."""
    ev = {
        "TARGET_PHASE": phase_id, "TARGET_TIE": tie_id, "TARGET_LEG": leg, "RESULT": None,
        "LEDGER_TOTAL_ROWS": 0, "LEDGER_PENDING_ROWS": 0, "LEDGER_SENT_ROWS": 0,
        "LEDGER_OTHER_ROWS": 0, "ENTRY_REFS_UNIQUE": 0,
        "CURRENT_SCHEMA_SHAPE": "canonical:recipients[]",
        "HISTORICAL_PAYLOAD_SHAPE": "legacy:empty-payload (sem recipients[])",
        "PROVIDER_SUCCESS_EVIDENCE": evidencia.get("delivered", 0),
        "PROVIDER_ERROR_EVIDENCE": evidencia.get("errors", 0),
        "PROPOSED_SENT_COUNT": 0,
        "PROVIDER_MESSAGE_ID_RECOVERABLE": "NO",
        "SENT_AT_SOURCE": evidencia.get("delivered_at") or "(ausente)",
        "TARGET_STATUS": BLOCKED, "MOTIVO": "",
    }

    entidade = L.entity_id(phase_id, tie_id, leg)
    ev["TARGET_ENTITY"] = entidade

    # 1. O alvo tem de existir e ter resultado gravado — reconciliação não inventa notificação.
    ties = (state.get("phases", {}).get(phase_id, {}) or {}).get("ties", {}) or {}
    if tie_id not in ties:
        ev["MOTIVO"] = "confronto inexistente na fase"
        return ev
    jogo = ((ties[tie_id].get("matches") or {}).get(leg)) or {}
    gh, ga = jogo.get("goalsHome"), jogo.get("goalsAway")
    if gh is None or ga is None:
        ev["MOTIVO"] = "a perna alvo nao tem resultado gravado"
        return ev
    ev["RESULT"] = f"{gh}-{ga}"
    if esperado and ev["RESULT"] != esperado:
        ev["MOTIVO"] = f"placar gravado ({ev['RESULT']}) difere do esperado ({esperado})"
        return ev

    # 2. Evidência EXTERNA de entrega. Sem ela não há o que reconciliar.
    if not evidencia.get("source_run"):
        ev["MOTIVO"] = "sem evidencia de execucao autorizada (--source-run) — pending nao prova entrega"
        return ev
    if not evidencia.get("delivered_at"):
        ev["MOTIVO"] = "sem instante de entrega (--delivered-at) — nao se usa a hora da reconciliacao"
        return ev
    if ev["PROVIDER_ERROR_EVIDENCE"] != 0:
        ev["MOTIVO"] = "a execucao autorizada registrou erro de provedor — entrega nao foi integral"
        return ev

    # 3. Estado do ledger para ESTE alvo.
    try:
        linhas = ledger.status_rows()
    except Exception as ex:  # noqa: BLE001 — ilegível nunca vira "pode escrever"
        ev["MOTIVO"] = f"ledger ilegivel: {type(ex).__name__}"
        return ev

    prefixo = L.idempotency_key(phase_id, tie_id, leg, "")
    pend, sent, outros, refs = classificar_linhas(linhas, prefixo)
    ev["LEDGER_TOTAL_ROWS"] = len(refs) + len([o for o in outros if ":" in str(o)])
    ev["LEDGER_TOTAL_ROWS"] = len(pend) + len(sent) + len(outros)
    ev["LEDGER_PENDING_ROWS"] = len(pend)
    ev["LEDGER_SENT_ROWS"] = len(sent)
    ev["LEDGER_OTHER_ROWS"] = len(outros)
    ev["ENTRY_REFS_UNIQUE"] = len(set(refs))

    if ev["LEDGER_TOTAL_ROWS"] and ev["LEDGER_SENT_ROWS"] == ev["LEDGER_TOTAL_ROWS"]:
        ev["TARGET_STATUS"] = ALREADY
        ev["MOTIVO"] = "todas as linhas do alvo ja estao sent — nada a reconciliar"
        return ev
    if ev["LEDGER_OTHER_ROWS"]:
        ev["MOTIVO"] = "ha linha em estado nao previsto (so pending/sent sao aceitos)"
        return ev
    if ev["LEDGER_SENT_ROWS"]:
        ev["MOTIVO"] = "reconciliacao parcial nao e permitida — ha linhas ja sent misturadas"
        return ev
    if ev["ENTRY_REFS_UNIQUE"] != ev["LEDGER_TOTAL_ROWS"]:
        ev["MOTIVO"] = "entry_ref duplicado entre as linhas do alvo"
        return ev
    if ev["LEDGER_TOTAL_ROWS"] != ev["PROVIDER_SUCCESS_EVIDENCE"]:
        ev["MOTIVO"] = (f"linhas ({ev['LEDGER_TOTAL_ROWS']}) != sucessos de provedor "
                        f"({ev['PROVIDER_SUCCESS_EVIDENCE']}) — conjuntos nao batem")
        return ev
    if ev["LEDGER_TOTAL_ROWS"] == 0:
        ev["MOTIVO"] = "nenhuma linha para este alvo"
        return ev

    # O predicado da ESCRITA, provado antes de escrever.
    #
    # Tudo acima conta linhas por prefixo de `idempotency_key`. A RPC atualiza por
    # `(pool_id, entity_id)`. São predicados DIFERENTES, e ate aqui nada provava que endereçam o
    # mesmo conjunto -- na primeira execucao real eles nao enderecaram: 12 linhas pelo prefixo,
    # nenhuma pelo entity_id, e a RPC levantou por contagem depois de o preflight ja ter dito READY.
    #
    # Um preflight que aprova o que a escrita nao consegue endereçar nao e um preflight.
    if por_entidade is not None:
        try:
            linhas_ent = por_entidade(L, ev["TARGET_ENTITY"])
        except Exception as e:  # noqa: BLE001 - ledger ilegivel bloqueia, nunca aprova
            ev["WRITE_PREDICATE_ROWS"] = "ILEGIVEL"
            ev["MOTIVO"] = f"nao foi possivel ler o predicado de escrita: {type(e).__name__}"
            return ev
        ev["WRITE_PREDICATE_ROWS"] = len(linhas_ent)
        if len(linhas_ent) != ev["LEDGER_TOTAL_ROWS"]:
            ev["MOTIVO"] = (
                f"o predicado de LEITURA acha {ev['LEDGER_TOTAL_ROWS']} linha(s) por prefixo de "
                f"idempotency_key, mas o predicado de ESCRITA acha {len(linhas_ent)} por "
                f"(pool_id, entity_id) — a RPC nao endereçaria o mesmo conjunto")
            return ev

    ev["PROPOSED_SENT_COUNT"] = ev["LEDGER_PENDING_ROWS"]
    ev["TARGET_STATUS"] = READY
    return ev


def imprimir(ev):
    print("=" * 72)
    print("  RECONCILIACAO DE ENTREGA HISTORICA — PREFLIGHT (SOMENTE LEITURA)")
    print("=" * 72)
    for k in ("TARGET_PHASE", "TARGET_TIE", "TARGET_LEG", "TARGET_ENTITY", "RESULT",
              "LEDGER_TOTAL_ROWS", "LEDGER_PENDING_ROWS", "LEDGER_SENT_ROWS", "LEDGER_OTHER_ROWS",
              "ENTRY_REFS_UNIQUE", "CURRENT_SCHEMA_SHAPE", "HISTORICAL_PAYLOAD_SHAPE",
              "PROVIDER_SUCCESS_EVIDENCE", "PROVIDER_ERROR_EVIDENCE", "PROPOSED_SENT_COUNT",
              "PROVIDER_MESSAGE_ID_RECOVERABLE", "SENT_AT_SOURCE", "TARGET_STATUS"):
        if k in ev:
            print(f"  {k} = {ev[k]}")
    if "WRITE_PREDICATE_ROWS" in ev:
        print(f"  WRITE_PREDICATE_ROWS = {ev['WRITE_PREDICATE_ROWS']}")
    if ev.get("MOTIVO"):
        print(f"  MOTIVO = {ev['MOTIVO']}")
    print("=" * 72)


def linhas_por_entidade(L, entidade, *, get=None):
    """Lê `bolao_notif_jobs` pelo MESMO predicado que a escrita usa: (pool_id, entity_id).

    Existe porque o preflight lia por prefixo de `idempotency_key` e a RPC escreve por
    `entity_id` -- dois predicados diferentes, e nada provava que concordam. Na primeira execução
    real eles NÃO concordaram: o preflight disse READY com 12 linhas e a RPC não endereçou nenhuma,
    levantou por contagem e devolveu 400. A guarda fez seu trabalho, mas tarde demais para ser
    diagnóstico: o operador viu um 400 sem explicação.

    Nenhum dado de participante sai daqui -- `entity_id` é `fase:confronto:perna` e `status` é
    enum. `entry_ref` NÃO é lido.
    """
    import json as _j, os as _os, urllib.parse as _up, urllib.request as _ur
    if get is None:
        base = _os.environ.get("SUPABASE_URL") or "https://cmhqkkfczotdnssupkni.supabase.co"
        chave = _os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
        if not chave:
            raise L.LedgerUnavailable("SUPABASE_SERVICE_ROLE_KEY ausente")
        def get(qs):
            req = _ur.Request(f"{base}/rest/v1/bolao_notif_jobs?{qs}",
                              headers={"apikey": chave, "Authorization": f"Bearer {chave}"})
            with _ur.urlopen(req, timeout=20) as r:
                corpo = r.read().decode()
            return _j.loads(corpo) if corpo.strip() else []
    qs = _up.urlencode({"pool_id": f"eq.{L.POOL_ID}", "entity_id": f"eq.{entidade}",
                        "select": "entity_id,status"})
    return get(qs)


def aplicar(L, ev, evidencia, rpc):
    """UMA chamada. A atomicidade mora no `update` único da função SQL, não aqui."""
    import urllib.error as _ue
    try:
        return _aplicar_bruto(L, ev, evidencia, rpc)
    except _ue.HTTPError as e:
        # O corpo carrega a MENSAGEM da guarda que levantou. Engoli-lo transforma uma recusa
        # explicada num 400 mudo -- foi o que aconteceu na primeira execução real.
        try:
            detalhe = e.read().decode()[:400]
        except Exception:  # noqa: BLE001 - se nem o corpo pode ser lido, o código HTTP é o que há
            detalhe = "(corpo ilegível)"
        raise RuntimeError(f"a RPC recusou (HTTP {e.code}): {detalhe}") from None


def _aplicar_bruto(L, ev, evidencia, rpc):
    r = rpc(RPC_RECONCILE, {
        "p_pool_id": L.POOL_ID,
        "p_entity_id": ev["TARGET_ENTITY"],
        "p_expected_rows": ev["PROPOSED_SENT_COUNT"],
        "p_reason": RECONCILIATION_REASON,
        "p_source_run": str(evidencia["source_run"]),
        "p_delivered_at": evidencia["delivered_at"],
    })
    linha = (r[0] if isinstance(r, list) and r else (r or {})) or {}
    return linha


def main(argv=None):
    ap = argparse.ArgumentParser(description="Reconciliacao de entrega historica ja ocorrida.")
    ap.add_argument("--phase", required=True)
    ap.add_argument("--tie", required=True)
    ap.add_argument("--leg", required=True, choices=["first", "second"])
    ap.add_argument("--expect-result", required=True)
    ap.add_argument("--source-run", required=True, help="id da execucao autorizada que entregou")
    ap.add_argument("--delivered-at", required=True, help="instante da execucao autorizada, ISO-8601")
    ap.add_argument("--delivered-count", required=True, type=int)
    ap.add_argument("--error-count", required=True, type=int)
    ap.add_argument("--apply", action="store_true", help="sem isto, so preflight")
    a = ap.parse_args(argv)

    L = _ledger_mod()
    sender_spec = importlib.util.spec_from_file_location("snd", AQUI / "send_result_email.py")
    S = importlib.util.module_from_spec(sender_spec)
    sender_spec.loader.exec_module(S)

    evidencia = {"source_run": a.source_run, "delivered_at": a.delivered_at,
                 "delivered": a.delivered_count, "errors": a.error_count}

    class _Leitor(L.SupabaseResultEmailLedger):
        def status_rows(self):
            linhas = self._rpc("bolao_notif_status_by_pool", {"p_pool_id": L.POOL_ID}) or []
            return [(r.get("idempotency_key") or "", r.get("status") or "") for r in linhas]

    reg = _Leitor()
    ev = preflight(L, a.phase, a.tie, a.leg, a.expect_result, evidencia, reg, S.sb_fetch(),
                   por_entidade=linhas_por_entidade)
    imprimir(ev)

    if not a.apply:
        return 0 if ev["TARGET_STATUS"] in (READY, ALREADY) else 3
    if ev["TARGET_STATUS"] == ALREADY:
        print("\n  ✓ ja reconciliado — nada a fazer (idempotente).")
        return 0
    if ev["TARGET_STATUS"] != READY:
        print(f"\n  🛑 RECUSADO — {ev['TARGET_STATUS']}. Nenhuma escrita.")
        return 3

    linha = aplicar(L, ev, evidencia, reg._rpc)
    print(f"\n  resultado: {linha.get('status')} — reconciled={linha.get('reconciled')} "
          f"already={linha.get('already')}")
    return 0 if str(linha.get("status")) in ("RECONCILED", "ALREADY_RECONCILED") else 1


if __name__ == "__main__":
    sys.exit(main())
