#!/usr/bin/env python3
"""
Recuperação ÚNICA de comprovantes: quem salvou de verdade hoje e ainda não tem recibo daquela versão.

Duas fases no mesmo processo, de propósito:

  --medir   mede, classifica, congela o manifesto e PARA. Não envia. Não reserva.
  --enviar  mede DE NOVO, exige que o manifesto seja idêntico ao congelado, e só então envia.

A segunda medição não é cerimônia. Entre medir e enviar, um participante pode salvar outra vez —
e aí o recibo sairia com a identidade de uma versão e o conteúdo de outra. Divergiu, aquele
destinatário é PULADO e reportado; ninguém recebe um documento que afirma o que não foi gravado.

═══ QUEM CONTA COMO "SALVOU HOJE" ═══════════════════════════════════════════════════════════════

`cdb_save_my_picks` só escreve `updatedAt` e `lastClientRef` no ramo que REALMENTE grava: os ramos
`identico` e `idempotente` retornam antes do UPDATE. Então abrir a página, recarregar, autenticar,
ou clicar em Salvar sem mudar nada não move nenhum dos dois campos.

Exigimos os DOIS:

  · `updatedAt` com a data de hoje  -> houve escrita hoje
  · `lastClientRef` presente        -> a escrita veio do caminho do PARTICIPANTE (a RPC com token),
                                       não de uma edição administrativa de documento inteiro, que
                                       mexe em `updatedAt` e nunca em `lastClientRef`

Sozinho, `updatedAt` classificaria uma correção administrativa como palpite novo de participante.

═══ NÃO REENVIAR PARA QUEM JÁ TEM ═══════════════════════════════════════════════════════════════

A identidade da entrega carrega a VERSÃO. Quem já recebeu recibo aceito da versão que está
gravada agora não entra — inclusive o operador, que recebeu e aprovou o comprovante da versão
dele no teste de template.

═══ TETO DE ENVIOS ══════════════════════════════════════════════════════════════════════════════

O laço percorre exatamente o manifesto congelado, e cada envio só acontece depois de uma reserva
concedida pelo banco (UNIQUE por app+chave+destinatário+geração). Além disso há um contador duro:
a chamada N+1 levanta antes de tocar no provedor.

Nenhum endereço é impresso. O relatório usa nome de entrada.
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(RAIZ / "bolao" / "shared" / "scripts"))
sys.path.insert(0, str(AQUI))

import urllib.request                      # noqa: E402
import m8m9                                # noqa: E402
import receipt_render as R                 # noqa: E402
import send_entry_saved_confirmation as C  # noqa: E402

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
ENTRADA_OPERADOR = "03e9fe14-d777-4a71-9c31-3d54dd21a07c"
FAMILIA = "cdb2026:entry-saved-confirmation-catchup-20260812"
APP = "cdb2026"
NY = timezone(timedelta(hours=-4))
DIA_ALVO = "2026-08-12"          # America/New_York


def rest(caminho):
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    req = urllib.request.Request(f"{SUPABASE}/rest/v1/{caminho}",
                                 headers={"apikey": k, "Authorization": f"Bearer {k}"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode())


def estado():
    linha = rest("bolao_state?id=eq.cdb2026&select=state")
    return (linha[0] if linha else {}).get("state") or {}


def dia_ny(iso):
    if not iso:
        return None
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t.astimezone(NY).strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001
        return None


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
        upd = e.get("updatedAt")
        dia = dia_ny(upd)
        tem_ref = bool(e.get("lastClientRef"))
        picks = e.get("picks") or {}
        versao = m8m9._rpc("cdb_picks_version", {"p_picks": picks})
        snap = snapshot_de(e, est)
        camp, vice = R.podio(snap)
        fases = [n for _, n, _ in R.FASES
                 if any((picks.get("matches") or {}).get(t) or (picks.get("qualified") or {}).get(t)
                        for t in _ties_da_fase(snap, _id_da_fase(n)))]

        material = (dia == DIA_ALVO) and tem_ref
        if dia == DIA_ALVO and not tem_ref:
            motivo = "updatedAt hoje SEM lastClientRef — escrita não veio do caminho do participante"
        elif dia != DIA_ALVO:
            motivo = f"último save em {dia or '(nunca)'} — não é hoje"
        elif eid == ENTRADA_OPERADOR:
            motivo = "salvou hoje, mas já recebeu e aprovou o comprovante desta mesma versão"
        else:
            motivo = "salvou hoje pelo caminho do participante e não tem recibo desta versão"

        reg = {
            "entryId": eid,
            "entryName": e.get("entryName") or "(sem nome)",
            "materialSave": material,
            "savedAt": upd,
            "savedAtNY": dia,
            "picksVersion": versao,
            "bracket": {"campeao": camp, "vice": vice, "fases": fases,
                        "confrontos": len((picks.get("matches") or {}))},
            "motivo": motivo,
        }
        todas.append(reg)

        # O operador já recebeu o recibo APROVADO desta versão (teste de template aceito).
        # Reenviar seria a duplicata que o item 2 proíbe nominalmente.
        if material and eid != ENTRADA_OPERADOR:
            elegiveis.append(reg)

    return todas, elegiveis


def _id_da_fase(nome):
    return next((i for i, n, _ in R.FASES if n == nome), None)


def _ties_da_fase(snap, fid):
    if not fid:
        return []
    reais = ((snap.get("phases") or {}).get(fid) or {}).get("ties") or {}
    if reais:
        return list(reais)
    return [t for t, _ in R.ties_virtuais(snap, fid)]


def hash_manifesto(elegiveis):
    """Identidade imutável do lote: entrada + versão, ordenado. Sem endereço."""
    corpo = sorted((r["entryId"], r["picksVersion"]) for r in elegiveis)
    return hashlib.sha256(json.dumps(corpo, sort_keys=True).encode()).hexdigest()[:16]


def relatar(todas, elegiveis, titulo):
    print(f"\n{'═' * 78}\n  {titulo}\n{'═' * 78}")
    for r in sorted(todas, key=lambda x: (not x["materialSave"], x["entryName"])):
        marca = "SALVOU HOJE" if r["materialSave"] else "não salvou hoje"
        print(f"  [{marca:>15}] {r['entryName']}")
        print(f"        MATERIAL_SAVE = {'YES' if r['materialSave'] else 'NO'}"
              f"   SAVED_AT = {r['savedAtNY'] or '(nunca)'}"
              f"   VERSION = {r['picksVersion']}")
        b = r["bracket"]
        print(f"        BRACKET = {b['confrontos']} confronto(s); campeão={b['campeao']}; "
              f"vice={b['vice']}; fases={b['fases']}")
        print(f"        MOTIVO  = {r['motivo']}")
    print(f"\n  TOTAL_CDB_ENTRIES             = {len(todas)}")
    print(f"  MATERIAL_SAVES_TODAY          = {sum(1 for r in todas if r['materialSave'])}")
    print(f"  ALREADY_RECEIVED_SAME_VERSION = "
          f"{sum(1 for r in todas if r['materialSave']) - len(elegiveis)}")
    print(f"  TARGETED_FOR_CATCHUP          = {len(elegiveis)}")
    print(f"  MANIFEST_HASH                 = {hash_manifesto(elegiveis)}")
    print(f"  ALVOS                         = {[r['entryName'] for r in elegiveis]}")


def enviar(elegiveis_congelados, hash_congelado):
    est = estado()
    apagadas = set(est.get("deletedIds") or [])
    por_id = {e.get("id"): e for e in est.get("entries", []) if e.get("id") not in apagadas}

    teto = len(elegiveis_congelados)
    chamadas = aceitos = falhos = incertos = pulados = 0

    for alvo in elegiveis_congelados:
        eid, versao_manifesto = alvo["entryId"], alvo["picksVersion"]
        nome = alvo["entryName"]

        entrada = por_id.get(eid)
        if entrada is None:
            print(f"  PULADO {nome}: entrada sumiu entre medir e enviar"); pulados += 1; continue

        # ── Recomputar a versão AGORA. Fecha a janela entre medir e enviar. ─────────────────
        snap = snapshot_de(entrada, est)
        versao_agora = m8m9._rpc("cdb_picks_version", {"p_picks": entrada.get("picks") or {}})
        if versao_agora != versao_manifesto:
            print(f"  PULADO {nome}: salvou de novo depois da medição "
                  f"({versao_manifesto} -> {versao_agora}); recibo sairia com versão errada")
            pulados += 1
            continue
        conferida = m8m9._rpc("cdb_picks_version", {"p_picks": snap["picks"]})
        if conferida != versao_manifesto:
            print(f"  PULADO {nome}: snapshot não confere com a versão"); pulados += 1; continue

        corpo = R.monta_recibo(snap, versao_manifesto)
        assunto = R.monta_assunto(snap.get("entryName") or "sua entrada")
        camp, vice = R.podio(snap)

        # Permissão nominal, aberta só para este destinatário e fechada logo depois.
        m8m9._rpc("cdb_grant_confirmation_allowance",
                  {"p_entry_id": eid, "p_note": "catch-up 2026-08-12 autorizado pelo operador"})
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

            # TETO DURO. A chamada N+1 é impossível: levanta antes de tocar no provedor.
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
                print(f"  ENVIADO {nome} — versão {versao_manifesto}, "
                      f"campeão={camp}, vice={vice}")
            else:
                # Incerto, nunca 'failed': o provedor pode ter aceitado e a resposta ter se
                # perdido. Liberar a reserva autorizaria um segundo envio para quem talvez já
                # tenha recebido.
                m8m9._rpc("settle_delivery", {"p_delivery_id": did, "p_status": "uncertain"})
                incertos += 1
                print(f"  INCERTO {nome}: {detalhe}")
        finally:
            m8m9._rpc("cdb_close_confirmation_allowance", {"p_entry_id": eid})

    print(f"\n  PROVIDER_CALLS = {chamadas}   ACCEPTED = {aceitos}   "
          f"FAILED = {falhos}   UNCERTAIN = {incertos}   PULADOS = {pulados}")
    return chamadas, aceitos, falhos, incertos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--medir", action="store_true")
    ap.add_argument("--enviar", action="store_true")
    ap.add_argument("--approve", help='para --enviar, exige "HUMAN_APPROVED"')
    args = ap.parse_args()

    todas, elegiveis = medir()
    relatar(todas, elegiveis, "MEDIÇÃO — quem salvou hoje (só leitura)")

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

    # Remedir e exigir manifesto idêntico. Mudou entre a medição e aqui, ninguém recebe.
    _, agora = medir()
    if hash_manifesto(agora) != congelado:
        print(f"  ABORTADO: manifesto mudou ({congelado} -> {hash_manifesto(agora)}). "
              "Exige nova aprovação.")
        return 1

    enviar(elegiveis, congelado)
    return 0


if __name__ == "__main__":
    sys.exit(main())
