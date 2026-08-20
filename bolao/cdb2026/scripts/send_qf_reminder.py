#!/usr/bin/env python3
"""CDB2026 — lembrete das quartas para quem AINDA NAO concluiu os palpites.

O QUE ESTE SCRIPT E
-------------------
Ferramenta de OPERADOR, sem cron. Mede quem nao completou os quatro confrontos das quartas,
rotaciona a credencial de acesso dessas entradas (a unica forma de entregar um link que
funciona -- ver abaixo), prova que os palpites nao foram tocados, e manda UM lembrete por
entrada com entrega exatamente-uma-vez.

POR QUE ROTACIONAR A CREDENCIAL E INEVITAVEL
--------------------------------------------
O token em claro do convite nao existe em lugar nenhum depois do envio: o banco guarda so o
SHA-256 (`cdb_entry_access.token_hash`). Nao ha caminho -- nem para o operador, nem para quem
tenha copia do banco -- que devolva o link ja entregue. Entao "reenviar o mesmo link" e
IMPOSSIVEL por construcao, e um lembrete sem link seria inutil: desde a migracao 20260812080000
o navegador nao enxerga e-mail de ninguem, logo nao existe "buscar minha entrada".

A rotacao usa `INV.issue_token()` -- a MESMA funcao do convite, nao uma copia. O upsert
`merge-duplicates` sobrescreve `token_hash` e zera `revoked_at`, entao o link ANTERIOR daquela
entrada para de autenticar no mesmo instante. Isso e REVOGACAO POR SUBSTITUICAO, e e deliberado:
o participante recebe o link novo no proprio lembrete, no mesmo e-mail.

O QUE A ROTACAO NAO PODE TOCAR (e como isso e PROVADO, nao afirmado)
--------------------------------------------------------------------
`cdb_entry_access` e outra tabela. Escrever credencial nao alcanca `bolao_state`. Mas "nao
alcanca" e argumento; este script MEDE:

  1. antes de qualquer escrita, tira impressao digital do estado autoritativo inteiro
     (`state_fingerprint`) e de cada entrada afetada (`picks_fingerprint`);
  2. depois da rotacao, RELE o estado e recalcula as duas;
  3. divergencia em qualquer uma ABORTA o lote antes de qualquer chamada ao provedor.

`cdb_my_entry` (usada para conferir o link) so escreve `cdb_entry_access.last_used_at` --
nunca `bolao_state`. Verificar link e seguro para palpite.

DUAS FASES, NESTA ORDEM, DE PROPOSITO
-------------------------------------
FASE A rotaciona e CONFERE os N links -- cada token novo e resolvido por `cdb_my_entry` e tem
        de devolver a MESMA entrada (id e nome) que o operador pretendia. Mapeamento 1:1
        estrito: dois tokens nunca podem cair na mesma entrada, e nenhuma entrada pode receber
        token de outra.
FASE B so comeca se as N conferencias passarem. Nenhum e-mail sai antes de todos os links
        estarem provados.

Se a Fase A falhar no meio, o lote aborta e NADA e enviado -- mas as credenciais ja rotacionadas
continuam rotacionadas. Isso e reportado explicitamente; o conserto e rodar de novo (rotaciona
outra vez e envia), nunca "deixar assim".

ENTREGA EXATAMENTE-UMA-VEZ
--------------------------
`reserve_delivery` / `settle_delivery`, os mesmos do comprovante. A unicidade e do banco
(`UNIQUE(app, business_key, recipient_hash, generation)` + `on conflict do nothing`), nao da
memoria deste processo: runner novo, worker concorrente e rerun do workflow batem todos na mesma
linha. ACCEPTED e terminal. Falha de transporte vira `uncertain` -- NUNCA `failed` e nunca
liberacao da reserva, porque o provedor pode ter aceitado e a resposta ter se perdido.

Sem `p_bypass_anomaly`: o disjuntor de envio rapido continua valendo.

Uso:
    python3 bolao/cdb2026/scripts/send_qf_reminder.py --measure     # manifesto, nao envia
    python3 bolao/cdb2026/scripts/send_qf_reminder.py --send        # rotaciona + envia
"""
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import send_invitation_email as INV   # noqa: E402  (reuso deliberado: mesma mecanica de credencial)

APP = "cdb2026"
FAMILY = "cdb2026:qf-reminder"
PHASE = "quartas"
EXPECTED_TIES = 4

SUBJECT = "Lembrete — seus palpites das quartas da Copa do Brasil"

# Ferramenta de operador: o modo `--measure` nao carrega guard nenhum e por isso e
# ESTRUTURALMENTE incapaz de enviar. So `--send` chega perto do provedor.
_TRANSPORT = None


def business_key(entry_id):
    """Identidade de entrega do lembrete. UMA por entrada, para esta campanha."""
    return f"{FAMILY}:{entry_id}:v1"


# ── IMPRESSOES DIGITAIS ──────────────────────────────────────────────────────────────────────
def _canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def state_fingerprint(state):
    """Hash do estado autoritativo INTEIRO.

    Deliberadamente global: cobre picks, qualified, scores, campeao/vice, identidade de entrada,
    pagamentos e resultados de uma vez. Se este numero nao mudar, nada em `bolao_state` mudou --
    nao ha campo protegido que escape dele.
    """
    return hashlib.sha256(_canon(state).encode()).hexdigest()


def picks_fingerprint(entry):
    """Hash dos palpites de UMA entrada, junto da identidade dela."""
    return hashlib.sha256(_canon({
        "id": entry.get("id"),
        "entryName": entry.get("entryName"),
        "picks": entry.get("picks") or {},
        "updatedAt": entry.get("updatedAt"),
    }).encode()).hexdigest()


# ── COMPLETUDE (mesma semantica do app -- nao uma segunda interpretacao) ─────────────────────
#
# `validatePicks()` em bolao/cdb2026/js/app.js: cada perna precisa de gols finitos em 0..20, e
# agregado empatado exige `qualified` para aquele confronto. Reproduzido aqui, nao reinventado.
def _leg_ok(m):
    if not isinstance(m, dict):
        return False
    for lado in ("goalsHome", "goalsAway"):
        v = m.get(lado)
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            return False
        if v < 0 or v > 20:
            return False
    return True


def tie_complete(tie_id, picks):
    mp = (picks.get("matches") or {}).get(tie_id) or {}
    primeira, segunda = mp.get("first"), mp.get("second")
    if not (_leg_ok(primeira) and _leg_ok(segunda)):
        return False
    a = primeira["goalsHome"] + segunda["goalsAway"]
    b = primeira["goalsAway"] + segunda["goalsHome"]
    if a == b and not (picks.get("qualified") or {}).get(tie_id):
        return False   # agregado empatado sem classificado = incompleto
    return True


def quarterfinal_status(entry, tie_ids):
    picks = entry.get("picks") or {}
    completos = [t for t in tie_ids if tie_complete(t, picks)]
    return {
        "entryId": entry.get("id"),
        "entryName": entry.get("entryName"),
        "scorelinesSaved": len(completos),
        "expectedTies": len(tie_ids),
        "complete": len(completos) == len(tie_ids),
        "lastSavedAt": entry.get("updatedAt"),
        "picksFingerprint": picks_fingerprint(entry),
    }


def quartas_tie_ids(state):
    fase = (state.get("phases") or {}).get(PHASE) or {}
    return sorted((fase.get("ties") or {}).keys())


def cutoff_of(state):
    return ((state.get("phases") or {}).get(PHASE) or {}).get("cutoffAt")


# ── ELEGIBILIDADE ────────────────────────────────────────────────────────────────────────────
def eligible(state):
    """Entradas reais, com destinatario resolvivel, cujas quartas NAO estao completas."""
    tie_ids = quartas_tie_ids(state)
    if len(tie_ids) != EXPECTED_TIES:
        raise RuntimeError(
            f"esperava {EXPECTED_TIES} confrontos nas quartas, encontrei {len(tie_ids)} — "
            "sorteio incompleto ou fase errada; nao meco completude contra topologia duvidosa"
        )
    apagados = set(state.get("deletedIds") or [])
    todas, alvos = [], []
    for e in state.get("entries") or []:
        if e.get("id") in apagados:
            continue
        st = quarterfinal_status(e, tie_ids)
        addr = (e.get("participantEmail") or "").strip()
        st["recipientResolvable"] = bool(addr)
        todas.append(st)
        if not st["complete"] and addr:
            alvos.append({**st, "_addr": addr})
    return todas, alvos, tie_ids


# ── E-MAIL ───────────────────────────────────────────────────────────────────────────────────
def build_html(link, cutoff_iso):
    prazo = INV._fmt_prazo(cutoff_iso)
    return f"""
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
            max-width:600px;margin:0 auto;color:#111827;line-height:1.6">
  <p style="font-size:16px">Olá!</p>

  <p style="font-size:15px">
    Passando para lembrar que os palpites da sua entrada para as <strong>quartas de final da
    Copa do Brasil 2026</strong> ainda não foram concluídos.
  </p>

  <p style="font-size:15px">
    O prazo seguro para salvar seus palpites é <strong>{prazo}</strong>. Recomendamos não deixar
    para os últimos minutos.
  </p>

  <p style="text-align:center;margin:28px 0">
    <a href="{link}"
       style="background:#059669;color:#fff;text-decoration:none;padding:14px 28px;
              border-radius:8px;font-weight:600;font-size:16px;display:inline-block">
      Preencher meus palpites
    </a>
  </p>

  <p style="font-size:14px;color:#374151">Para preencher:</p>
  <ol style="font-size:14px;color:#374151;padding-left:20px">
    <li>Abra seu link pessoal no botão acima.</li>
    <li>Confira o <strong>nome da sua entrada</strong> exibido no formulário. Ele aparecerá
        automaticamente preenchido e não poderá ser editado, para você confirmar que abriu a
        entrada correta.</li>
    <li>Preencha os placares e indique o classificado nos quatro confrontos.</li>
    <li>Clique em <strong>“Salvar entrada”</strong> e confira a confirmação de que seus palpites
        foram salvos.</li>
  </ol>

  <p style="font-size:13px;color:#6b7280;word-break:break-all">
    Se o botão não funcionar, use este endereço: <br>{link}
  </p>

  <p style="font-size:14px;color:#374151">
    <strong>Importante:</strong> seu link é pessoal e abre diretamente a sua entrada. Não é
    necessário informar email ou código. Não compartilhe esse link, pois qualquer pessoa que
    tiver acesso a ele poderá alterar seus palpites.
  </p>

  <p style="font-size:14px;color:#374151">
    Se você já concluiu e salvou seus palpites depois deste levantamento, pode desconsiderar
    este lembrete.
  </p>

  <p style="font-size:15px">Obrigado e boa sorte!</p>
  <p style="font-size:14px;color:#6b7280">Bolão do Ferrari<br>Copa do Brasil 2026</p>
</div>
""".strip()


# ── RPC ──────────────────────────────────────────────────────────────────────────────────────
def _rpc(fn, args):
    st, r = INV._req("POST", f"/rest/v1/rpc/{fn}", args)
    if st not in (200, 201, 204):
        raise RuntimeError(f"rpc {fn} falhou: http={st} {r}")
    return r


# ── FASE A — ROTACAO E CONFERENCIA DOS LINKS ─────────────────────────────────────────────────
def rotate_and_verify(alvos, *, rpc=_rpc, issue=None, verbose=True):
    """Rotaciona a credencial de cada alvo e PROVA que o link novo abre a entrada certa.

    Devolve a lista congelada de linhas prontas para envio. Levanta ao primeiro desvio -- um
    link que resolve para a entrada errada e o unico defeito aqui que mandaria a pessoa editar
    os palpites de outra pessoa, entao ele nao vira aviso, vira aborto.
    """
    issue = issue or INV.issue_token
    carimbo = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    prontos = []
    vistos_entry, vistos_token = set(), set()

    for alvo in alvos:
        eid, nome = alvo["entryId"], alvo["entryName"]
        token = issue(eid, f"lembrete quartas; rotacionado {carimbo}")
        if not token or len(token) < 32:
            raise RuntimeError(f"token invalido emitido para {eid[:8]}…")
        if token in vistos_token:
            raise RuntimeError("COLISAO DE TOKEN entre duas entradas — abortando o lote inteiro")
        vistos_token.add(token)

        # CONFERENCIA PELO MESMO CAMINHO DO NAVEGADOR. Se `cdb_my_entry` nao devolver ESTA
        # entrada, o link esta errado e nenhum e-mail pode sair.
        vista = rpc("cdb_my_entry", {"p_token": token})
        if not vista:
            raise RuntimeError(f"link novo de {nome} nao autentica — abortando o lote")
        if vista.get("id") != eid:
            raise RuntimeError(
                f"CROSS_ENTRY_LINK_MISMATCH: link de {nome} resolveu para outra entrada — "
                "abortando o lote inteiro"
            )
        if (vista.get("entryName") or "") != (nome or ""):
            raise RuntimeError(
                f"nome divergente para {eid[:8]}…: link diz {vista.get('entryName')!r}, "
                f"estado diz {nome!r} — abortando"
            )
        if eid in vistos_entry:
            raise RuntimeError(f"entrada {eid[:8]}… apareceu duas vezes no lote — abortando")
        vistos_entry.add(eid)

        prontos.append({**alvo, "_token": token,
                        "linkEntryId": vista["id"], "linkEntryName": vista["entryName"]})
        if verbose:
            print(f"  LINK OK   {nome:<24} entrada {eid[:8]}…  nome confere")

    if len(prontos) != len(alvos):
        raise RuntimeError("contagem de links conferidos diverge da de alvos — abortando")
    return prontos


# ── PROVA DE NAO-MUTACAO ─────────────────────────────────────────────────────────────────────
def assert_state_untouched(antes_fp, antes_por_entrada, depois_state, verbose=True):
    """Aborta se QUALQUER coisa no estado autoritativo mudou durante a rotacao."""
    depois_fp = state_fingerprint(depois_state)
    if depois_fp != antes_fp:
        # Nao basta dizer "mudou": dizer QUAL entrada mudou e o que torna isto acionavel.
        culpadas = []
        por_id = {e.get("id"): e for e in depois_state.get("entries") or []}
        for eid, fp in antes_por_entrada.items():
            atual = por_id.get(eid)
            if atual is None or picks_fingerprint(atual) != fp:
                culpadas.append(eid[:8] + "…")
        raise RuntimeError(
            "AUTHORITATIVE_STATE_CHANGED durante a rotacao — nenhum e-mail sera enviado. "
            f"entradas afetadas: {culpadas or 'nenhuma das do lote (mudanca fora do lote)'}"
        )
    if verbose:
        print(f"  PICKS INTACTOS  fingerprint do estado inalterada ({depois_fp[:12]}…)")
    return depois_fp


# ── FASE B — ENVIO ───────────────────────────────────────────────────────────────────────────
def send_batch(prontos, cutoff_iso, *, rpc=_rpc, envia=None, verbose=True):
    """Um e-mail por entrada, com reserva duravel antes de cada chamada ao provedor."""
    envia = envia or INV.send_email
    teto = len(prontos)
    provider_calls = aceitos = incertos = pulados = 0

    for linha in prontos:
        nome, eid, addr = linha["entryName"], linha["entryId"], linha["_addr"]
        link = f"{INV.SITE_URL}#t={linha['_token']}"
        html = build_html(link, cutoff_iso)

        # TETO DURO: a chamada N+1 levanta antes de tocar no provedor.
        if provider_calls >= teto:
            raise RuntimeError(f"TETO ESTOURADO: {provider_calls} >= {teto}")

        reserva = rpc("reserve_delivery", {
            "p_app": APP,
            "p_business_key": business_key(eid),
            "p_recipient": addr,
            "p_generation": 1,
            "p_family": FAMILY,
        })
        reserva = (reserva or [{}])[0] if isinstance(reserva, list) else (reserva or {})
        if not reserva.get("reserved"):
            print(f"  PULADO  {nome}: {reserva.get('reason')}")
            pulados += 1
            continue
        did = reserva["delivery_id"]

        provider_calls += 1
        try:
            status, detalhe = envia(addr, SUBJECT, html)
            ok = status in (200, 201, 202)
        except Exception as exc:                      # noqa: BLE001
            status, detalhe, ok = None, repr(exc), False

        if ok:
            rpc("settle_delivery", {"p_delivery_id": did, "p_status": "accepted",
                                    "p_provider_msg_id": None})
            aceitos += 1
            print(f"  ENVIADO {nome:<24} {INV.mask_email(addr)}")
        else:
            # `uncertain`, nunca `failed`: o provedor pode ter aceitado e a resposta ter se
            # perdido. Liberar a reserva autorizaria um segundo envio para a mesma pessoa.
            rpc("settle_delivery", {"p_delivery_id": did, "p_status": "uncertain",
                                    "p_provider_msg_id": None})
            incertos += 1
            print(f"  INCERTO {nome:<24} {INV.mask_email(addr)}: {detalhe}")

    return {"providerCalls": provider_calls, "accepted": aceitos,
            "uncertain": incertos, "skipped": pulados}


# ── JA ENTREGUES ─────────────────────────────────────────────────────────────────────────────
def already_reminded(alvos, *, rpc=_rpc):
    """Entradas cuja reserva de lembrete JA existe no ledger duravel.

    Lido por `delivery_count`, a funcao de leitura do proprio ledger -- nao por uma segunda
    fonte de verdade. Se `reserve_delivery` recusaria, esta medicao tem de dizer o mesmo, e a
    unica forma de garantir isso e perguntar a mesma tabela.

    QUALQUER reserva existente conta, nao so `accepted`:
      accepted   terminal por definicao;
      claimed    reserva viva -- reenviar seria a duplicata que a reserva existe para impedir;
      uncertain  o provedor pode ter entregue e a resposta ter se perdido. Reenviar por conta
                 propria e exatamente o que a regra "UNCERTAIN nunca e reenviado
                 automaticamente" proibe.

    Falha FECHADA: sem ledger legivel nao se envia.
    """
    entregues = set()
    for a in alvos:
        r = rpc("delivery_count", {"p_app": APP, "p_business_key": business_key(a["entryId"])})
        linha = (r[0] if isinstance(r, list) and r else r) or {}
        if not isinstance(linha, dict) or "total" not in linha:
            raise RuntimeError(
                f"ledger ilegivel para {a['entryId'][:8]}… ({linha!r}) — sem ledger nao se envia"
            )
        if (linha.get("total") or 0) > 0:
            entregues.add(a["entryId"])
    return entregues


# ── MANIFESTO ────────────────────────────────────────────────────────────────────────────────
def print_manifest(todas, alvos, entregues, titulo):
    print("=" * 78)
    print(f"  {titulo}")
    print("=" * 78)
    print(f"\n  {'ENTRY_NAME':<24} {'QF':<5} {'RECIP':<6} {'JA_LEMBRADO':<12} WOULD_SEND")
    print("  " + "-" * 72)
    alvo_ids = {a["entryId"] for a in alvos}
    would = 0
    for s in sorted(todas, key=lambda r: (r["complete"], r["entryName"] or "")):
        eh_alvo = s["entryId"] in alvo_ids
        ja = s["entryId"] in entregues
        manda = eh_alvo and not ja
        would += 1 if manda else 0
        print(f"  {(s['entryName'] or '?'):<24} "
              f"{s['scorelinesSaved']}/{s['expectedTies']}  "
              f"{('SIM' if s['recipientResolvable'] else 'NAO'):<6} "
              f"{('SIM' if ja else 'nao'):<12} "
              f"{'SIM' if manda else '—'}")
    completos = sum(1 for s in todas if s["complete"])
    print(f"\n  TOTAL_REAL_ENTRIES      = {len(todas)}")
    print(f"  QUARTERFINAL_COMPLETE   = {completos}")
    print(f"  QUARTERFINAL_INCOMPLETE = {len(todas) - completos}")
    print(f"  SKIPPED_COMPLETE_COUNT  = {completos}")
    print(f"  ALREADY_SENT_COUNT      = {len(entregues)}")
    print(f"  WOULD_SEND_COUNT        = {would}")
    return would


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    modo = ap.add_mutually_exclusive_group()
    modo.add_argument("--measure", action="store_true",
                      help="so mede e imprime o manifesto (padrao; incapaz de enviar)")
    modo.add_argument("--send", action="store_true",
                      help="rotaciona credenciais e envia de verdade")
    args = ap.parse_args()
    enviando = bool(args.send)

    print("=" * 78)
    print("  CDB2026 — LEMBRETE DAS QUARTAS")
    print(f"  modo: {'ENVIO REAL' if enviando else 'MEDICAO (nao envia)'}")
    print("=" * 78)

    # DISJUNTOR, antes de qualquer coisa.
    bloqueado, motivo = INV.transport_blocked_by_kill_switch()
    if bloqueado and enviando:
        print(f"\n🛑 {motivo}")
        return 4

    estado = INV.fetch_state()
    cutoff = cutoff_of(estado)
    if not cutoff:
        # Regra §50: sem prazo publicado nao se convida nem se lembra.
        print("\n🛑 fase 'quartas' sem cutoffAt publicado — lembrete nao faz sentido.")
        return 3
    venceu = datetime.fromisoformat(cutoff.replace("Z", "+00:00")) <= datetime.now(timezone.utc)
    if venceu:
        print(f"\n🛑 o prazo ja venceu ({cutoff}) — lembrete nao faz sentido.")
        return 3

    todas, alvos, tie_ids = eligible(estado)
    print(f"\n  fase          {PHASE}  ({len(tie_ids)} confrontos)")
    print(f"  prazo         {INV._fmt_prazo(cutoff)}")

    entregues = already_reminded(alvos)
    would = print_manifest(todas, alvos, entregues, "MANIFESTO")

    pendentes = [a for a in alvos if a["entryId"] not in entregues]
    if not enviando:
        print("\n  MANIFEST_FROZEN = YES")
        print("  PROVIDER_CALLS  = 0   (modo medicao e estruturalmente incapaz de enviar)")
        print("=" * 78)
        return 0

    if not pendentes:
        print("\n  ✓ nada a enviar — todo mundo ja foi lembrado ou ja completou.")
        print("  PROVIDER_CALLS = 0")
        print("=" * 78)
        return 0

    permitido, motivo = INV.real_send_allowed()
    if not permitido:
        print(f"\n🛑 {motivo}")
        return 2

    # ── IMPRESSAO DIGITAL ANTES DE QUALQUER ESCRITA ──────────────────────────────────────────
    fp_antes = state_fingerprint(estado)
    por_entrada = {a["entryId"]: a["picksFingerprint"] for a in pendentes}
    print(f"\n  ESTADO ANTES  fingerprint {fp_antes[:12]}…  ({len(por_entrada)} entradas medidas)")

    # ── FASE A ───────────────────────────────────────────────────────────────────────────────
    print(f"\n  FASE A — rotacao e conferencia de {len(pendentes)} links")
    prontos = rotate_and_verify(pendentes)

    # Rele o estado e PROVE que a rotacao nao encostou em palpite nenhum.
    depois = INV.fetch_state()
    assert_state_untouched(fp_antes, por_entrada, depois)

    # Reconferencia de elegibilidade com o estado FRESCO: quem salvou entre medir e enviar
    # deixou de ser alvo.
    _, alvos_agora, _ = eligible(depois)
    ainda = {a["entryId"] for a in alvos_agora}
    prontos = [p for p in prontos if p["entryId"] in ainda]
    print(f"  RECHECK       {len(prontos)} ainda incompletos ao vivo")
    if not prontos:
        print("\n  ✓ todos completaram durante a rotacao — nada a enviar.")
        print("  PROVIDER_CALLS = 0")
        return 0

    # ── FASE B ───────────────────────────────────────────────────────────────────────────────
    print(f"\n  FASE B — envio de {len(prontos)} lembretes")
    r = send_batch(prontos, cutoff)

    # Prova pos-envio: o estado autoritativo continua intacto.
    assert_state_untouched(fp_antes, por_entrada, INV.fetch_state())

    print(f"\n  TARGET_COUNT   = {len(prontos)}")
    print(f"  PROVIDER_CALLS = {r['providerCalls']}")
    print(f"  ACCEPTED       = {r['accepted']}")
    print(f"  UNCERTAIN      = {r['uncertain']}")
    print(f"  SKIPPED        = {r['skipped']}")
    print("=" * 78)
    return 0 if r["uncertain"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
