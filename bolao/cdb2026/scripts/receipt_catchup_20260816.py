#!/usr/bin/env python3
"""
Recuperação ÚNICA de comprovantes (2026-08-16): quem salvou pelo caminho seguro
(`cdb_save_my_picks`, token) ANTES da permissão nominal existir para a entrada — e por isso o
save nunca criou obrigação no outbox — e ainda não tem recibo da versão atualmente gravada.

Mesmo mecanismo e mesmas camadas de `receipt_catchup.py` (2026-08-12), só que o alvo não é "quem
salvou NUM DIA especifico" — é "quem salvou pelo caminho do participante (`lastClientRef`
presente) e não tem recibo aceito da versão atual". Duas fases no mesmo processo, de propósito:

  --medir   mede, classifica, congela o manifesto e PARA. Não envia. Não reserva.
  --enviar  remede, exige que o manifesto seja idêntico ao congelado, e só então envia.

═══ POR QUE NÃO É UM DUPLICADO POSSÍVEL ═════════════════════════════════════════════════════════

`reserve_delivery` usa UNIQUE(app, business_key, recipient_hash, generation); a chave carrega a
versão gravada (`cdb_picks_version`). Rodar este script duas vezes, ou rodar depois que o
consumidor agendado processar um evento real da MESMA versão, dá `JA_ENTREGUE` na segunda
tentativa — o e-mail nunca sai duas vezes para o mesmo conteúdo.

═══ QUEM FICA DE FORA POR CONSTRUÇÃO ════════════════════════════════════════════════════════════

  · `lastClientRef` ausente — a entrada nunca gravou pelo caminho seguro; ou já recebeu recibo
    pelo caminho ANTIGO do navegador (`queueReceipt()`/EmailJS), que nunca dependeu de permissão
    nem de kill switch e continuou funcionando o tempo todo.
  · ENTRADA_OPERADOR — já recebeu e aprovou o comprovante da versão dele no teste de template
    (`cdb_current_receipt_snapshot`, 2026-08-13). Mesma exclusão nominal do catch-up de 12/08.

Nenhum endereço é impresso. O relatório usa nome de entrada.
"""

import argparse
import hashlib
import json
import os
import sys
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
FAMILIA = "cdb2026:entry-saved-confirmation-catchup-20260816"
APP = "cdb2026"


def rest(caminho):
    import urllib.request
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    req = urllib.request.Request(f"{SUPABASE}/rest/v1/{caminho}",
                                 headers={"apikey": k, "Authorization": f"Bearer {k}"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode())


def estado():
    linha = rest("bolao_state?id=eq.cdb2026&select=state")
    return (linha[0] if linha else {}).get("state") or {}


def snapshot_de(entrada, est):
    picks = entrada.get("picks") or {}
    canon = {"matches": picks.get("matches") or {}, "qualified": picks.get("qualified") or {}}
    fases = {}
    for fid, fase in (est.get("phases") or {}).items():
        if not isinstance(fase, dict):
            continue
        fases[fid] = {
            "ties": {tid: {"teamA": t.get("teamA"), "teamB": t.get("teamB")}
                     for tid, t in (fase.get("ties") or {}).items()},
            "topology": ((fase.get("topology") or {}).get("slots")) or {},
        }
    return {"picks": canon, "entryName": entrada.get("entryName"),
            "savedAt": entrada.get("updatedAt"), "phases": fases}


def medir():
    """Devolve (todas, elegiveis). Só leitura."""
    est = estado()
    apagadas = set(est.get("deletedIds") or [])
    todas, elegiveis = [], []

    for e in est.get("entries", []):
        eid = e.get("id")
        if not eid or eid in apagadas:
            continue
        tem_ref = bool(e.get("lastClientRef"))
        picks = e.get("picks") or {}
        versao = m8m9._rpc("cdb_picks_version", {"p_picks": picks})
        snap = snapshot_de(e, est)
        camp, vice = R.podio(snap)

        material = tem_ref
        if not tem_ref:
            motivo = "lastClientRef ausente — nunca salvou pelo caminho seguro (ou já recebeu pelo antigo)"
        elif eid == ENTRADA_OPERADOR:
            motivo = "é o operador — já recebeu e aprovou o comprovante desta versão no teste de template"
        else:
            motivo = "salvou pelo caminho do participante e não tem recibo desta versão"

        reg = {
            "entryId": eid,
            "entryName": e.get("entryName") or "(sem nome)",
            "materialSave": material,
            "savedAt": e.get("updatedAt"),
            "picksVersion": versao,
            "bracket": {"campeao": camp, "vice": vice,
                        "confrontos": len((picks.get("matches") or {}))},
            "motivo": motivo,
        }
        todas.append(reg)

        if material and eid != ENTRADA_OPERADOR:
            elegiveis.append(reg)

    return todas, elegiveis


def hash_manifesto(elegiveis):
    corpo = sorted((r["entryId"], r["picksVersion"]) for r in elegiveis)
    return hashlib.sha256(json.dumps(corpo, sort_keys=True).encode()).hexdigest()[:16]


def relatar(todas, elegiveis, titulo):
    print(f"\n{'═' * 78}\n  {titulo}\n{'═' * 78}")
    for r in sorted(todas, key=lambda x: (not x["materialSave"], x["entryName"])):
        marca = "ALVO" if (r["materialSave"] and r["entryId"] != ENTRADA_OPERADOR) else "fora"
        print(f"  [{marca:>4}] {r['entryName']}")
        print(f"        SAVED_AT = {r['savedAt'] or '(nunca)'}   VERSION = {r['picksVersion']}")
        b = r["bracket"]
        print(f"        BRACKET  = {b['confrontos']} confronto(s); campeão={b['campeao']}; vice={b['vice']}")
        print(f"        MOTIVO   = {r['motivo']}")
    print(f"\n  TOTAL_CDB_ENTRIES    = {len(todas)}")
    print(f"  TARGETED_FOR_CATCHUP = {len(elegiveis)}")
    print(f"  MANIFEST_HASH        = {hash_manifesto(elegiveis)}")
    print(f"  ALVOS                = {[r['entryName'] for r in elegiveis]}")


def enviar(elegiveis_congelados, hash_congelado):
    est = estado()
    apagadas = set(est.get("deletedIds") or [])
    por_id = {e.get("id"): e for e in est.get("entries", []) if e.get("id") not in apagadas}

    teto = len(elegiveis_congelados)
    chamadas = aceitos = incertos = pulados = 0

    for alvo in elegiveis_congelados:
        eid, versao_manifesto = alvo["entryId"], alvo["picksVersion"]
        nome = alvo["entryName"]

        entrada = por_id.get(eid)
        if entrada is None:
            print(f"  PULADO {nome}: entrada sumiu entre medir e enviar"); pulados += 1; continue

        snap = snapshot_de(entrada, est)
        versao_agora = m8m9._rpc("cdb_picks_version", {"p_picks": entrada.get("picks") or {}})
        if versao_agora != versao_manifesto:
            print(f"  PULADO {nome}: salvou de novo depois da medição "
                  f"({versao_manifesto} -> {versao_agora}); recibo sairia com versão errada")
            pulados += 1
            continue

        corpo = R.monta_recibo(snap, versao_manifesto)
        assunto = R.monta_assunto(snap.get("entryName") or "sua entrada")
        camp, vice = R.podio(snap)

        m8m9._rpc("cdb_grant_confirmation_allowance",
                  {"p_entry_id": eid, "p_note": "catch-up 2026-08-16 autorizado pelo operador"})
        try:
            r = m8m9._rpc("cdb_confirmation_recipient", {"p_entry_id": eid})
            linha = r[0] if r else {}
            if not linha.get("allowed") or not linha.get("recipient"):
                print(f"  PULADO {nome}: destinatário não resolvível no servidor")
                pulados += 1
                continue
            addr = linha["recipient"]

            pii = R.varre_pii(corpo, extras=[addr, eid])
            if pii:
                print(f"  PULADO {nome}: PII_SCAN falhou {pii}"); pulados += 1; continue

            if chamadas >= teto:
                raise RuntimeError(f"TETO ESTOURADO: {chamadas} >= {teto}")

            chave = f"{FAMILIA}:{eid}:{versao_manifesto}:v1"
            rr = m8m9._rpc("reserve_delivery", {
                "p_app": APP, "p_business_key": chave, "p_recipient": addr, "p_generation": 1,
                "p_family": FAMILIA, "p_bypass_anomaly": True,
            })
            reserva = rr[0] if rr else {}
            if not reserva.get("reserved"):
                print(f"  PULADO {nome}: {reserva.get('reason')}"); pulados += 1; continue
            did = reserva["delivery_id"]

            chamadas += 1
            ok, detalhe, msg_id = C.envia(addr, assunto, corpo)
            if ok:
                m8m9._rpc("settle_delivery", {"p_delivery_id": did, "p_status": "accepted",
                                              "p_provider_msg_id": msg_id})
                aceitos += 1
                print(f"  ENVIADO {nome} — versão {versao_manifesto}, campeão={camp}, vice={vice}")
            else:
                m8m9._rpc("settle_delivery", {"p_delivery_id": did, "p_status": "uncertain"})
                incertos += 1
                print(f"  INCERTO {nome}: {detalhe}")
        finally:
            m8m9._rpc("cdb_close_confirmation_allowance", {"p_entry_id": eid})

    print(f"\n  PROVIDER_CALLS = {chamadas}   ACCEPTED = {aceitos}   "
          f"UNCERTAIN = {incertos}   PULADOS = {pulados}")
    return chamadas, aceitos, incertos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--medir", action="store_true")
    ap.add_argument("--enviar", action="store_true")
    ap.add_argument("--approve", help='para --enviar, exige "HUMAN_APPROVED"')
    args = ap.parse_args()

    todas, elegiveis = medir()
    relatar(todas, elegiveis, "MEDIÇÃO — quem salvou pelo caminho seguro e não tem recibo (só leitura)")

    if not args.enviar:
        return 0
    if args.approve != "HUMAN_APPROVED":
        print("\nrecusado: --enviar exige --approve HUMAN_APPROVED")
        return 2

    congelado = hash_manifesto(elegiveis)
    print(f"\n{'═' * 78}\n  ENVIO — manifesto congelado {congelado}\n{'═' * 78}")
    if not elegiveis:
        print("  nenhum alvo — nada a enviar")
        return 0

    _, agora = medir()
    if hash_manifesto(agora) != congelado:
        print(f"  ABORTADO: manifesto mudou ({congelado} -> {hash_manifesto(agora)}). "
              "Exige nova aprovação.")
        return 1

    enviar(elegiveis, congelado)
    return 0


if __name__ == "__main__":
    sys.exit(main())
