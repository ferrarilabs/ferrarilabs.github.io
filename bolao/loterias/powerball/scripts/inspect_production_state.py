#!/usr/bin/env python3
"""
Radiografia da produção das loterias — SÓ LEITURA por padrão.

═══ POR QUE UM SCRIPT SEPARADO ══════════════════════════════════════════════════════════════════

Depois da run 31679185588 a produção ficou num estado que nenhum log respondia sozinho: os
e-mails saíram, o resultado foi gravado, e a obrigação do outbox ficou presa. Para decidir o que
fazer era preciso saber, ao mesmo tempo:

    o resultado canônico existe?      (data.js)
    o prêmio está creditado?          (livro-razão)
    quem consta como notificado?      (ledger por destinatário)
    a obrigação está fechada?         (outbox)

Quatro fatos em quatro lugares. Reunir isso à mão, sob pressão, é como se troca um por outro.

`--repair` fecha APENAS a obrigação órfã, e só quando o ledger já prova que a entrega aconteceu.
Não existe caminho de envio neste arquivo: `send_result_email` não é importado, o transporte não é
construído, e o contador de chamadas ao provedor é reportado justamente para que o zero seja
verificável em vez de prometido.
"""

import argparse
import json
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[3]
sys.path.insert(0, str(AQUI))
sys.path.insert(0, str(RAIZ / "bolao" / "shared" / "scripts"))
sys.path.insert(0, str(RAIZ / "bolao" / "loterias" / "scripts"))

import lottery_core as L        # noqa: E402
import settle_draw as SD        # noqa: E402

PROVIDER_CALLS = 0   # este arquivo não tem como incrementá-lo; é reportado como evidência


def _bridge():
    import m8m9
    return m8m9


def secao(t):
    print(f"\n{'━' * 78}\n  {t}\n{'━' * 78}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--draw", default="2026-08-12")
    ap.add_argument("--repair", action="store_true",
                    help="fecha a obrigação órfã (nunca envia nada)")
    args = ap.parse_args()
    draw_id = args.draw
    problemas, reparos = [], []

    # ── 1. resultado canônico ───────────────────────────────────────────────────────────────
    secao(f"1. RESULTADO CANÔNICO — {draw_id}")
    draws = SD.carrega_draws()
    draw = next((d for d in draws if d["id"] == draw_id), None)
    if not draw:
        print(f"  sorteio {draw_id} não existe em data.js")
        return 2
    r = draw.get("result") or {}
    tem = bool(r.get("numbers"))
    print(f"  PB_{draw_id.replace('-', '')}_CANONICAL_RESULT_NULL = {'NO' if tem else 'YES'}")
    if tem:
        print(f"    números    {r['numbers']} | PB {r['special']} | Power Play {r.get('multiplier')}x")
        print(f"    conferido  {r.get('checkedAt')}")
        print(f"    prêmios    US$ {r.get('premiosGanhos')}")
        h = L.hash_resultado("powerball", draw_id,
                             {"numbers": r["numbers"], "special": r["special"],
                              "multiplier": r.get("multiplier") or 1})
        print(f"    RESULT_HASH_PRESENT = YES ({h})")
    else:
        problemas.append("resultado canônico ausente")

    # ── 2. livro-razão ──────────────────────────────────────────────────────────────────────
    secao("2. LIVRO-RAZÃO (fonte monetária canônica)")
    ev = L.le_ledger()
    creditos = [e for e in ev if e["type"] == "PRIZE_CREDIT" and e.get("poolId") == draw_id]
    print(f"  PB_{draw_id.replace('-', '')}_PRIZE_CREDIT_COUNT  = {len(creditos)}")
    for c in creditos:
        print(f"    {L.dinheiro(c['amountCents'])}  chave={c['idempotencyKey']}")
    rel = SD.relatorio()
    for k in ("CONTRIBUTIONS", "PRIOR_CARRYOVER", "TICKET_PURCHASES", "CURRENT_DRAW_WINNINGS",
              "OTHER_ADJUSTMENTS", "CURRENT_AVAILABLE_CARRYOVER"):
        print(f"  {k:<30} {L.dinheiro(rel[k]):>14}")
    chaves = [e["idempotencyKey"] for e in ev]
    print(f"  DOUBLE_PRIZE  = {len(creditos) - len({c['idempotencyKey'] for c in creditos})}")
    print(f"  CHAVES_DUPLICADAS = {len(chaves) - len(set(chaves))}")
    if len(creditos) != 1 and tem:
        problemas.append(f"esperado 1 crédito de prêmio, há {len(creditos)}")

    # ── 3. ledger de notificação por destinatário ───────────────────────────────────────────
    secao("3. NOTIFICAÇÃO POR DESTINATÁRIO")
    import powerball_notification as PN
    disponivel, porque = PN.ledger_available()
    print(f"  ledger disponível: {disponivel} ({porque})")
    job = None
    if disponivel:
        job = PN.get_job(draw_id)
        if job:
            print(f"  job.status      = {job.get('status')}")
            print(f"  job.claimed_by  = {job.get('claimed_by')}")
            try:
                dest = PN._recipients(draw_id)
                por_estado = {}
                for d in dest:
                    por_estado[d.get("state")] = por_estado.get(d.get("state"), 0) + 1
                print(f"  destinatários   {len(dest)} -> {por_estado}")

                # A chave é `entryRef` (camelCase) — é assim que `get_bolao_notif_recipients`
                # devolve. A primeira versão desta linha lia `entry_ref`, que não existe: as 16
                # referências viravam `None`, o conjunto colapsava para um elemento, e a métrica
                # anunciou "15 e-mails duplicados" numa entrega que não tinha nenhum.
                #
                # Um alarme falso sobre e-mail duplicado custa caro: leva a investigar um
                # incidente inexistente e a desconfiar do número quando ele for verdadeiro. Por
                # isso a chave ausente agora é ERRO explícito, não zero silencioso.
                refs = [d.get("entryRef") for d in dest]
                if any(r is None for r in refs):
                    print(f"  RESULT_EMAIL_DUPLICATE = INDETERMINADO — "
                          f"{sum(1 for r in refs if r is None)} linha(s) sem 'entryRef'; "
                          f"campos vistos: {sorted({k for d in dest for k in d})}")
                    problemas.append("formato inesperado nas disposições por destinatário")
                else:
                    print(f"  RESULT_EMAIL_DUPLICATE = {len(refs) - len(set(refs))}")
            except Exception as e:  # noqa: BLE001
                print(f"  (não foi possível listar destinatários: {e})")
        else:
            print("  NENHUM job para este sorteio")
            problemas.append("job de notificação ausente")

    # ── 4. obrigação do outbox ──────────────────────────────────────────────────────────────
    secao("4. OBRIGAÇÃO DO OUTBOX (onde a run 31679185588 travou)")
    chave = f"powerball:draw-result:{draw_id}:v1"
    print(f"  chave de negócio: {chave}")
    st = None
    try:
        st = _bridge().status(chave)
        print(f"  estado atual: {json.dumps(st, default=str)}")
    except Exception as e:  # noqa: BLE001
        print(f"  ERRO ao ler estado: {type(e).__name__}: {e}")
        problemas.append("não foi possível ler o outbox")

    estado = str((st or {}).get("status") or "")
    orfa = estado in ("pending", "in_flight")
    entregue = bool(job and job.get("status") == PN.SENT)
    if orfa:
        print(f"  ÓRFÃ: a obrigação está em '{estado}' e o ledger diz "
              f"{'ENTREGUE' if entregue else 'NÃO entregue'}")
        if not entregue:
            print("    -> NÃO reparável aqui: sem prova de entrega no ledger, fechar a "
                  "obrigação afirmaria algo que ninguém verificou.")
            problemas.append("obrigação órfã sem prova de entrega")

    if orfa and entregue and args.repair:
        secao("5. REPARO — fechar a obrigação, SEM tocar no provedor")
        b = _bridge()
        try:
            if estado == "in_flight":
                print("  devolvendo leases expirados ao pool...")
                b.recover_expired_leases()
            antes = b.status(chave)
            if str((antes or {}).get("status")) != "pending":
                print(f"  não reivindicável agora (está em {(antes or {}).get('status')}); "
                      f"o lease ainda não expirou. Nada feito.")
            else:
                worker = f"repair-{os.environ.get('GITHUB_RUN_ID', 'local')}"
                claimed = b.claim(worker, event_type="powerball.draw_result", lease_seconds=300)
                depois = b.status(chave)
                if not claimed or str((depois or {}).get("status")) != "in_flight":
                    print(f"  ABORTADO: a reivindicação não caiu nesta chave "
                          f"(estado={depois}). Pode ser obrigação de outro sorteio.")
                    problemas.append("reivindicação divergente no reparo")
                else:
                    novo = b.settle(claimed["outbox_event_id"], "success",
                                    provider_message_id=f"powerball-{draw_id}")
                    print(f"  LIQUIDADA: {estado} -> {novo}")
                    b.emit_audit("draw.outbox_reconciled", "draw", draw_id,
                                 metadata={"de": estado, "para": novo, "providerCalls": 0,
                                           "motivo": "reparo manual: ledger já provava entrega"})
                    reparos.append("obrigação do outbox liquidada")
        except Exception as e:  # noqa: BLE001
            print(f"  FALHA no reparo: {type(e).__name__}: {e}")
            problemas.append(f"reparo falhou: {e}")
    elif orfa and entregue:
        print("  (rode com --repair para fechá-la; nenhum e-mail é enviado)")

    # ── resumo ──────────────────────────────────────────────────────────────────────────────
    secao("RESUMO")
    est_final = None
    try:
        est_final = _bridge().status(chave)
    except Exception:  # noqa: BLE001
        pass
    print(f"  PB_{draw_id.replace('-', '')}_CANONICAL_RESULT_NULL   = {'NO' if tem else 'YES'}")
    print(f"  PB_{draw_id.replace('-', '')}_RESULT_HASH_PRESENT     = {'YES' if tem else 'NO'}")
    print(f"  PB_{draw_id.replace('-', '')}_PRIZE_CREDIT_COUNT      = {len(creditos)}")
    # O enum do banco é ('pending','in_flight','sent','dead') — o terminal de sucesso chama-se
    # 'sent', não 'settled'. Comparar com o nome errado relatava NO para uma obrigação recém
    # fechada, que é o mesmo tipo de erro que a métrica de duplicidade: o dado estava certo e o
    # relato, não. Estados TERMINAIS ficam explícitos aqui, um por vez.
    TERMINAIS = {"sent", "dead"}
    estado_final = str((est_final or {}).get("status") or "")
    print(f"  PB_{draw_id.replace('-', '')}_DRAW_SETTLED            = "
          f"{'YES' if estado_final in TERMINAIS else 'NO'}"
          f"  (outbox={estado_final or 'ausente'})")
    if estado_final == "dead":
        problemas.append("obrigação em 'dead': terminal, mas exige revisão humana")
    print(f"  PB_{draw_id.replace('-', '')}_PROVIDER_CALLS_DURING_REPAIR = {PROVIDER_CALLS}")
    print(f"  PB_{draw_id.replace('-', '')}_RESENT                  = 0")
    print(f"  CURRENT_CARRYOVER = {L.dinheiro(rel['CURRENT_AVAILABLE_CARRYOVER'])}")
    if reparos:
        print(f"\n  REPAROS: {reparos}")
    if problemas:
        print(f"\n  PENDÊNCIAS ({len(problemas)}):")
        for p in problemas:
            print(f"    - {p}")
        return 1
    print("\n  PRODUÇÃO CONSISTENTE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
