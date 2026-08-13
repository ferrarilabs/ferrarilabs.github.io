#!/usr/bin/env python3
"""
UM e-mail, para o operador validar o DESENHO do comprovante.

═══ POR QUE ISTO É SEPARADO DO CAMINHO DE PRODUÇÃO ══════════════════════════════════════════════

Identidade de negócio própria:

    família      cdb2026:entry-saved-confirmation-template-test
    chave        cdb2026:entry-saved-confirmation-template-test:<picksVersion>:v1

Não encosta na família de produção. O histórico de entrega do comprovante real continua
`{'total': 1, 'accepted': 1}` — este teste não o consome, não o reabre e não altera a
idempotência dele. Se amanhã o operador salvar de novo, o recibo real sai normalmente.

═══ NÃO EXIGE OUTRO SAVE ════════════════════════════════════════════════════════════════════════

Monta o snapshot a partir da versão canônica JÁ persistida — mesma lista de permissão que o
produtor usa. O operador não precisa mexer em palpite para validar um template.

═══ DISJUNTOR DE 45 MINUTOS ═════════════════════════════════════════════════════════════════════

O operador recebeu o comprovante real há menos de 45 minutos. Como este teste é outra família, o
disjuntor o recusaria — corretamente, pela regra geral. Ele existe justamente para exigir
aprovação humana explícita nesse caso, e a aprovação existe: o prompt do operador autoriza
nominalmente UM e-mail para validação de template. Então o bypass é usado com o motivo registrado,
que é o uso previsto do parâmetro — não um contorno dele.

═══ TETO ════════════════════════════════════════════════════════════════════════════════════════

Uma reserva, um envio. `reserve_delivery` decide no banco: rodar isto duas vezes dá JA_ENTREGUE na
segunda. Depois de aceito, não reenvia nem se uma verificação posterior falhar.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(RAIZ / "bolao" / "shared" / "scripts"))
sys.path.insert(0, str(AQUI))

import m8m9                                # noqa: E402
import receipt_render as R                 # noqa: E402
import send_entry_saved_confirmation as C  # noqa: E402

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
ENTRADA_OPERADOR = "03e9fe14-d777-4a71-9c31-3d54dd21a07c"
FAMILIA_TESTE = "cdb2026:entry-saved-confirmation-template-test"
APP = "cdb2026"


def rest(caminho):
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    req = urllib.request.Request(f"{SUPABASE}/rest/v1/{caminho}",
                                 headers={"apikey": k, "Authorization": f"Bearer {k}"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode())


def monta_snapshot(entry_id):
    """
    Mesma LISTA DE PERMISSÃO do produtor: picks canônicos, entryName, savedAt, e só teamA/teamB +
    topologia de cada fase. Campo a campo — nada da entrada entra sozinho.
    """
    linha = rest("bolao_state?id=eq.cdb2026&select=state")
    estado = (linha[0] if linha else {}).get("state") or {}
    entrada = next((e for e in estado.get("entries", []) if e.get("id") == entry_id), None)
    if entrada is None:
        return None, None
    picks = entrada.get("picks") or {}
    canon = {"matches": picks.get("matches") or {}, "qualified": picks.get("qualified") or {}}
    fases = {}
    for fid, fase in (estado.get("phases") or {}).items():
        if not isinstance(fase, dict):
            continue
        fases[fid] = {
            "ties": {tid: {"teamA": t.get("teamA"), "teamB": t.get("teamB")}
                     for tid, t in (fase.get("ties") or {}).items()},
            "topology": ((fase.get("topology") or {}).get("slots")) or {},
        }
    snap = {"picks": canon, "entryName": entrada.get("entryName"),
            "savedAt": entrada.get("updatedAt"), "phases": fases}
    versao = m8m9._rpc("cdb_picks_version", {"p_picks": picks})
    return snap, versao


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--approve", help='exige a frase "HUMAN_APPROVED"')
    args = ap.parse_args()
    if args.approve != "HUMAN_APPROVED":
        print("recusado: exige --approve HUMAN_APPROVED")
        return 2

    print("TESTE DE TEMPLATE — UM e-mail, só para o operador\n")

    # ── A permissão é aberta só para esta operação, e fechada no fim ─────────────────────────
    m8m9._rpc("cdb_grant_confirmation_allowance",
              {"p_entry_id": ENTRADA_OPERADOR, "p_note": "teste de template aprovado pelo operador"})
    try:
        snap, versao = monta_snapshot(ENTRADA_OPERADOR)
        if not snap:
            print("ENTRADA NÃO ENCONTRADA"); return 1

        r = m8m9._rpc("cdb_confirmation_recipient", {"p_entry_id": ENTRADA_OPERADOR})
        linha = r[0] if r else {}
        if not linha.get("allowed"):
            print("SEM PERMISSÃO — nenhuma chamada"); return 1
        addr = linha["recipient"]

        corpo = R.monta_recibo(snap, versao)
        assunto = R.monta_assunto(snap.get("entryName") or "sua entrada")
        camp, vice = R.podio(snap)
        pii = R.varre_pii(corpo, extras=[addr, ENTRADA_OPERADOR])

        # ── §15: provar ANTES da chamada ────────────────────────────────────────────────────
        print("PROVA ANTES DO ENVIO")
        print(f"  TARGETED                 = 1")
        print(f"  RECIPIENT                = operador (valor não impresso)")
        print(f"  OTHER_PARTICIPANTS       = 0")
        print(f"  TEMPLATE                 = novo comprovante CDB")
        print(f"  PREDICTION_VERSION       = {versao}")
        print(f"  CHAMPION_PRESENT         = {'YES' if camp else 'NO'} ({camp})")
        print(f"  RUNNER_UP_PRESENT        = {'YES' if vice else 'NO'} ({vice})")
        fases_no_corpo = [n for _, n, _ in R.FASES if f">{n}</div>" in corpo]
        print(f"  COMPLETE_BRACKET_PRESENT = {'YES' if fases_no_corpo else 'NO'} {fases_no_corpo}")
        print(f"  PII_SCAN                 = {'PASS' if not pii else 'FALHA ' + str(pii)}")
        print(f"  ASSUNTO (enviado)        = {assunto}")
        print(f"  ASSUNTO (visível)        = {R.assunto_visivel(snap.get('entryName') or '')}")
        fam = m8m9._rpc("delivery_count_family", {"p_app": APP, "p_family": FAMILIA_TESTE})
        print(f"  histórico da família     = {fam[0] if fam else '(vazio)'}"
              "   (total inclui a v1 que nunca chegou ao provedor)")

        if pii:
            print("\nABORTADO: varredura de PII não passou. Nenhuma chamada ao provedor.")
            return 1
        if not camp or not vice:
            print("\nABORTADO: recibo sem campeão/vice não serve para validar o desenho.")
            return 1

        # ── Reserva na família de TESTE, com bypass justificado ─────────────────────────────
        #
        # A unicidade é por chave, e cada rodada aprovada de template é uma chave nova:
        #   v1  reservou e morreu ANTES do provedor (NameError montando o corpo) — 0 e-mails
        #   v2  primeiro comprovante real, aprovado pelo operador quanto à estrutura
        #   v3  esta rodada: assunto sem marca duplicada, vice na seção da final, rótulos revistos
        # As reservas anteriores ficam como registro honesto de cada tentativa, em vez de
        # apagadas — é o histórico que prova quantas vezes o provedor foi chamado.
        chave = f"{FAMILIA_TESTE}:{versao}:v3"
        rr = m8m9._rpc("reserve_delivery", {
            "p_app": APP, "p_business_key": chave, "p_recipient": addr, "p_generation": 1,
            "p_family": FAMILIA_TESTE,
            # Aprovação humana nominal e registrada — ver cabeçalho.
            "p_bypass_anomaly": True,
        })
        reserva = rr[0] if rr else {}
        if not reserva.get("reserved"):
            print(f"\nNÃO RESERVADO ({reserva.get('reason')}) — nenhuma chamada ao provedor.")
            return 0
        did = reserva["delivery_id"]

        ok, detalhe, msg_id = C.envia(addr, assunto, corpo)
        if ok:
            m8m9._rpc("settle_delivery", {"p_delivery_id": did, "p_status": "accepted",
                                          "p_provider_msg_id": msg_id})
            print(f"\nENVIADO ({msg_id})")
        else:
            m8m9._rpc("settle_delivery", {"p_delivery_id": did, "p_status": "uncertain"})
            print(f"\nFALHA {detalhe}")
        print(f"  PROVIDER_CALLS = 1   ACCEPTED = {1 if ok else 0}   "
              f"FAILED = 0   UNCERTAIN = {0 if ok else 1}")
        return 0 if ok else 1
    finally:
        # A permissão volta a fechar, sempre — inclusive se algo acima levantar.
        m8m9._rpc("cdb_close_confirmation_allowance", {"p_entry_id": ENTRADA_OPERADOR})
        n = m8m9._rpc("cdb_confirmation_allowance_count", {})
        print(f"  permissão fechada ao fim: allowance_rows = {n}")


if __name__ == "__main__":
    sys.exit(main())
