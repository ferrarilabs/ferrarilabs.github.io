#!/usr/bin/env python3
"""
Consumidor confiável do comprovante de "entrada salva" do CDB2026.

    save seguro  ->  evento durável (mesma transação)  ->  ESTE consumidor  ->  1 chamada  ->  liquidação

═══ POR QUE O COMPROVANTE SAIU DO NAVEGADOR ═════════════════════════════════════════════════════

O caminho antigo era `queueReceipt()` -> `sendReceipt()` -> EmailJS, com
`to_email: entry.participantEmail`. Ele depende de o navegador CONHECER o endereço do
participante. Não conhece mais, e isso é a correção, não uma falta: `cdb_my_entry` devolve
`id`, `entryName`, `picks`, `updatedAt` e nada mais.

Reexpor o endereço para o cliente poder endereçar o e-mail desfaria exatamente a correção de PII
deste incidente. Então o envio mudou de lado: quem sabe o endereço é o servidor, e é o servidor
que manda.

═══ O QUE GARANTE "EXATAMENTE UM" ═══════════════════════════════════════════════════════════════

Três camadas independentes, porque hoje o operador recebeu quatro e-mails em 45 minutos e
nenhuma promessa minha vale mais que um mecanismo:

  1. CHAVE DE IDEMPOTÊNCIA do outbox, derivada da ENTRADA
     `cdb2026:entry-saved-confirmation:<entryId>:v1`. Salvar dez vezes cria UM evento; o
     `on conflict do nothing` transforma repetição em no-op. Chave com timestamp faria de cada
     save uma notificação nova — foi assim que a tempestade aconteceu.

  2. `reserve_delivery`, com UNIQUE(app, business_key, recipient_hash, generation)
     Mesmo que dois consumidores rodem juntos, ou que o evento seja reemitido à mão, o banco
     concede a reserva a UM. O segundo recebe `JA_ENTREGUE` e não chama o provedor.

  3. `claim_outbox_event`, com `for update skip locked`
     Dois processos não pegam o mesmo evento. O lease vence sozinho se este processo morrer, e
     `recover_expired_outbox_leases()` devolve a linha à fila — cair não vira "nunca mais sai".

E o disjuntor de anomalia de `reserve_delivery` continua ligado: se este destinatário recebeu
outra coisa deste app nos últimos 45 minutos, a reserva é RECUSADA. Isso é exatamente o padrão de
hoje, e ele passa a exigir aprovação explícita em vez de acontecer.

═══ O DESTINATÁRIO NÃO VEM DO EVENTO ════════════════════════════════════════════════════════════

O payload carrega `entryId`, nunca endereço. Quem traduz é `cdb_confirmation_recipient()`, que só
devolve endereço se existir permissão para aquela entrada. O portão está NO BANCO: este script é
estruturalmente incapaz de obter o endereço de quem não está liberado. Não é disciplina minha, é
ausência de caminho.

═══ KILL SWITCH ═════════════════════════════════════════════════════════════════════════════════

`bolao/cdb2026/EMAIL_KILL_SWITCH` continua valendo, e continua ATIVO, para convite, correção,
reenvio, link novo e broadcast. O comprovante de entrada salva é a ÚNICA exceção, e ela é NOMINAL,
não categórica: só sai para uma entrada que o operador liberou por nome na tabela de permissão,
que nasce vazia e se fecha sozinha depois da primeira entrega aceita.

Uma exceção categórica ("comprovantes são sempre permitidos") reabriria a porta para todo mundo.
Esta abre para uma linha, uma vez.
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(RAIZ / "bolao" / "shared" / "scripts"))

import m8m9  # noqa: E402

EVENT_TYPE = "cdb2026.entry_saved_confirmation"

# ── A CHAVE DE NEGOCIO CARREGA A VERSAO GRAVADA ──────────────────────────────────────────────
#
# Era constante (`cdb2026:entry-saved-confirmation:v1`). Constante significa que a PRIMEIRA
# entrega aceita bloqueia todas as futuras com JA_ENTREGUE -- o participante corrige um palpite
# semanas depois e nunca mais recebe recibo. Um comprovante confirma um ESTADO GRAVADO; estados
# diferentes sao entregas diferentes.
#
# FAMILY e o que agrupa as versoes. O disjuntor de 45 minutos compara familia, entao dois
# comprovantes de dois estados distintos nao se acusam de anomalia -- enquanto convite seguido de
# correcao, que sao familias diferentes, continuam se acusando. Era o padrao de 2026-08-12.
FAMILY = "cdb2026:entry-saved-confirmation"


def business_key(versao):
    """Identidade de entrega da VERSAO. `versao` e o hash canonico vindo do evento."""
    return f"{FAMILY}:{versao}:v1"

# ── SEPARAÇÃO CANÁRIO / PRODUÇÃO ─────────────────────────────────────────────────────────────
#
# O teste troca `EVENT_TYPE` por um tipo de canário. Isso não é cosmético: `claim_outbox_event`
# filtra por tipo, então o consumidor AGENDADO fica estruturalmente incapaz de pegar um evento de
# teste. Sem essa separação, o cron de 5 em 5 minutos podia reivindicar um evento criado pelo
# teste e mandar e-mail DE VERDADE para o operador — a forma exata do incidente de hoje.
#
# `EVENT_TYPE_PROD` guarda o valor de produção mesmo quando `EVENT_TYPE` foi trocado, para o
# cinto-e-suspensório abaixo saber em qual dos dois papéis está rodando.
EVENT_TYPE_PROD = "cdb2026.entry_saved_confirmation"
CANARY_EVENT_TYPE = "cdb2026.entry_saved_confirmation.canary"
APP          = "cdb2026"
KILL_SWITCH  = RAIZ / "bolao" / "cdb2026" / "EMAIL_KILL_SWITCH"

EMAILJS_URL = "https://api.emailjs.com/api/v1.0/email/send"
EMAILJS_KEY = "GBZFujsJBET6modve"
EMAILJS_SVC = "service_o4hyzxr"
EMAILJS_TMPL = "template_xq7yzzb"
# Mesmos headers dos remetentes comprovados. O EmailJS valida a Origin contra a allowlist do
# painel; `https://www.ferrarilabs.com` (a origem canônica de produção) NÃO está lá e devolve 403 —
# foi o que derrubou as 12 primeiras tentativas de convite. Não "corrigir" para a origem canônica.
EMAILJS_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"),
    "Origin":  "https://ferrarilabs.github.io",
    "Referer": "https://ferrarilabs.github.io/bolao/cdb2026/",
}

# Transporte injetável. Só os testes escrevem aqui.
_TRANSPORT = None


def set_transport(fn):
    """Instala um transporte falso. Usado pelos testes; nunca em produção."""
    global _TRANSPORT
    _TRANSPORT = fn


def real_send_allowed():
    if os.environ.get("BOLAO_ALLOW_REAL_SEND") != "I UNDERSTAND":
        return False, "BOLAO_ALLOW_REAL_SEND ausente"
    return True, None


def kill_switch_permite():
    """
    Exceção nominal, documentada no cabeçalho. O kill switch segue bloqueando convite, correção,
    reenvio, link novo e broadcast; este canal passa porque o portão dele é mais estreito que o
    próprio kill switch — a permissão nomeia UMA entrada e se consome.
    """
    if KILL_SWITCH.exists():
        return True, ("kill switch ATIVO; comprovante passa por exceção nominal — "
                      "o portão efetivo é a permissão por entrada")
    return True, None


def _agora_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def monta_html(entry_name, saved_at):
    """
    Comprovante e nada mais. Sem token, sem link novo, sem linguagem de convite ou de correção:
    quem recebe isto já tem acesso — foi usando o acesso que ele salvou.
    """
    quando = (saved_at or "")[:19].replace("T", " ")
    return f"""<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="margin:0 0 4px;font-size:20px;color:#0b6b3a">Palpites salvos</h2>
  <p style="margin:0 0 20px;font-size:14px;color:#666">Copa do Brasil 2026</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 16px">
    Seus palpites da entrada <strong>{entry_name}</strong> foram gravados com sucesso.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px">
    <tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #eee">Entrada</td>
        <td style="padding:8px 0;text-align:right;border-bottom:1px solid #eee"><strong>{entry_name}</strong></td></tr>
    <tr><td style="padding:8px 0;color:#666">Gravado em (UTC)</td>
        <td style="padding:8px 0;text-align:right">{quando}</td></tr>
  </table>
  <p style="font-size:13px;line-height:1.6;color:#666;margin:0">
    Você pode continuar editando pelo mesmo link de acesso que já usou, até o prazo da fase.
    Este é só um comprovante — não é preciso responder.
  </p>
</div>"""


def envia(addr, entry_name, html):
    permitido_ks, nota_ks = kill_switch_permite()
    if not permitido_ks:
        return False, nota_ks, None
    if _TRANSPORT is None:
        ok, motivo = real_send_allowed()
        if not ok:
            return False, f"EMAIL_SEND_BLOCKED: {motivo}", None

    body = json.dumps({
        "service_id": EMAILJS_SVC, "template_id": EMAILJS_TMPL, "user_id": EMAILJS_KEY,
        "template_params": {"to_email": addr.strip(), "entry_name": entry_name,
                            "receipt_code": "Palpites salvos", "html_message": html},
    }).encode()

    if _TRANSPORT is not None:
        status, detalhe = _TRANSPORT(EMAILJS_URL, body, EMAILJS_HEADERS)
        return (status == 200), detalhe, f"fake:{status}"

    try:
        req = urllib.request.Request(EMAILJS_URL, data=body, headers=EMAILJS_HEADERS, method="POST")
        with urllib.request.urlopen(req, timeout=20) as r:
            return (r.status == 200), "ok", f"emailjs:{r.status}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.read()[:200]!r}", None
    except Exception as e:  # noqa: BLE001 — qualquer falha de rede é transitória por definição
        return False, f"{type(e).__name__}: {e}", None


def processa_um(lease_owner, verbose=True):
    """
    Devolve (resultado, provider_calls). `resultado` é um rótulo curto para os testes lerem.
    Nunca levanta por falha de envio: falha vira liquidação, e liquidação é o que mantém a fila
    honesta.
    """
    ev = m8m9.claim(lease_owner, event_type=EVENT_TYPE, lease_seconds=300)
    if ev is None:
        return "SEM_EVENTO", 0

    chamadas = 0
    eid = ev["outbox_event_id"]
    entry_id = (ev.get("payload") or {}).get("entryId")
    saved_at = (ev.get("payload") or {}).get("savedAt")

    # Cinto e suspensório. O filtro de tipo já deveria tornar isto inalcançável em produção; se
    # algum dia alcançar, é porque alguém emitiu um canário com o tipo de produção, e aí a
    # resposta certa é recusar — não descobrir depois, na caixa de entrada de alguém.
    if EVENT_TYPE == EVENT_TYPE_PROD and str(ev.get("idempotency_key", "")).startswith("canary:"):
        m8m9.settle(eid, "permanent_failure", failure_category="canario_no_caminho_de_producao")
        if verbose:
            print("  CANARIO_RECUSADO no consumidor de produção — nenhuma chamada")
        return "CANARIO_RECUSADO", 0

    try:
        if not entry_id:
            m8m9.settle(eid, "permanent_failure", failure_category="payload_sem_entry_id")
            return "PAYLOAD_INVALIDO", 0

        # ── Destinatário resolvido AQUI, com service_role, e só se houver permissão ──────────
        r = m8m9._rpc("cdb_confirmation_recipient", {"p_entry_id": entry_id})
        linha = r[0] if r else {}
        if not linha.get("allowed"):
            # Sem permissão não é erro transitório: é uma decisão. Não insistir.
            m8m9.settle(eid, "permanent_failure", failure_category="sem_permissao")
            if verbose:
                print(f"  SEM_PERMISSAO entry={entry_id[:8]}… — nenhuma chamada ao provedor")
            return "SEM_PERMISSAO", 0

        addr = linha["recipient"]
        entry_name = linha.get("entry_name") or "sua entrada"

        # ── Reserva: unicidade POR VERSAO + disjuntor por familia, ambos no banco ───────────
        #
        # Sem `picksVersion` o evento veio de um produtor antigo. Recusar em vez de inventar uma
        # versao: chave chutada aqui poderia colidir com a de outro estado e suprimir um recibo
        # legitimo, ou nao colidir com nada e reenviar um ja entregue.
        versao = (ev.get("payload") or {}).get("picksVersion")
        if not versao:
            m8m9.settle(eid, "permanent_failure", failure_category="payload_sem_picks_version")
            if verbose:
                print("  SEM_VERSAO no payload — nenhuma chamada ao provedor")
            return "SEM_VERSAO", 0

        rr = m8m9._rpc("reserve_delivery", {
            "p_app": APP, "p_business_key": business_key(versao), "p_recipient": addr,
            "p_generation": 1, "p_family": FAMILY,
        })
        reserva = rr[0] if rr else {}
        if not reserva.get("reserved"):
            motivo = reserva.get("reason") or "reserva recusada"
            if motivo.startswith("JA_ENTREGUE"):
                # Já saiu. O evento cumpriu seu propósito; encerrar sem chamar o provedor.
                m8m9.settle(eid, "success", provider_message_id="ja_entregue")
                if verbose:
                    print("  JA_ENTREGUE — nenhuma chamada ao provedor")
                return "JA_ENTREGUE", 0
            # Anomalia: transitória de propósito. A janela passa e a tentativa seguinte vale.
            m8m9.settle(eid, "transient_failure", failure_category="anomalia_envio_rapido")
            if verbose:
                print(f"  BLOQUEADO {motivo}")
            return "ANOMALIA", 0

        delivery_id = reserva["delivery_id"]

        # ── Provedor ────────────────────────────────────────────────────────────────────────
        chamadas = 1
        ok, detalhe, msg_id = envia(addr, entry_name, monta_html(entry_name, saved_at))

        if ok:
            m8m9._rpc("settle_delivery", {"p_delivery_id": delivery_id,
                                          "p_status": "accepted", "p_provider_msg_id": msg_id})
            m8m9.settle(eid, "success", provider_message_id=msg_id)
            # A permissão se consome: valia para UMA validação. Se este fechamento falhar, a
            # permissão fica aberta — mas o teto de e-mails continua UM, porque a reserva em
            # `notification_deliveries` já existe e recusa o próximo. Por isso o aviso é ruidoso
            # e não fatal: perder o fechamento degrada a defesa, não a rompe.
            try:
                m8m9._rpc("cdb_close_confirmation_allowance", {"p_entry_id": entry_id})
            except Exception as e:  # noqa: BLE001
                print(f"  AVISO: entrega OK, permissão NÃO fechou ({type(e).__name__}: {e}) — "
                      f"fechar à mão; a unicidade de entrega segue impedindo segundo envio")
            # O e-mail JÁ SAIU. A partir daqui nada pode desfazer a operação, e escrituração que
            # falha não pode virar exceção que sobe: o `except` lá embaixo tentaria devolver o
            # evento à fila, ele já está 'sent', e o consumidor terminaria gritando sobre uma
            # entrega que deu certo. Registrar é importante; é menos importante que não mentir
            # sobre o que aconteceu.
            try:
                m8m9.emit_audit("cdb_entry_saved_confirmation.sent", "outbox_event",
                                aggregate_key=ev["idempotency_key"],
                                metadata={"app": APP, "recipientHash": hashlib.sha256(
                                    addr.strip().lower().encode()).hexdigest()[:12]})
            except Exception as e:  # noqa: BLE001
                print(f"  AVISO: entrega OK, auditoria falhou ({type(e).__name__}: {e})")
            if verbose:
                print(f"  ENVIADO ({msg_id}) — permissão fechada")
            return "ENVIADO", chamadas

        # Falhou DEPOIS de reservar. A reserva fica marcada 'uncertain', não 'failed': o provedor
        # pode ter aceitado e a resposta ter se perdido. Liberar a reserva aqui seria autorizar um
        # segundo envio para alguém que talvez já tenha recebido.
        m8m9._rpc("settle_delivery", {"p_delivery_id": delivery_id, "p_status": "uncertain"})
        m8m9.settle(eid, "transient_failure", failure_category="provedor_recusou")
        if verbose:
            print(f"  FALHA {detalhe}")
        return "FALHA_ENVIO", chamadas

    except Exception as e:  # noqa: BLE001
        # Qualquer coisa inesperada: devolver o evento à fila em vez de deixá-lo preso in_flight.
        try:
            m8m9.settle(eid, "transient_failure", failure_category=f"erro_consumidor:{type(e).__name__}")
        except Exception:  # noqa: BLE001 — se nem liquidar dá, o lease vence sozinho
            pass
        raise


def main():
    ap = argparse.ArgumentParser(description="Consumidor do comprovante de entrada salva (CDB2026)")
    ap.add_argument("--run", action="store_true", help="processa eventos pendentes")
    ap.add_argument("--max", type=int, default=5, help="teto de eventos por execução")
    ap.add_argument("--status", action="store_true", help="só relata, não envia")
    ap.add_argument("--entry", help="entryId a inspecionar na fila (diagnóstico, só leitura)")
    args = ap.parse_args()

    if args.status:
        n = m8m9._rpc("cdb_confirmation_allowance_count", {})
        c = m8m9._rpc("delivery_count_family", {"p_app": APP, "p_family": FAMILY})
        print(f"permissoes_abertas = {n}")
        print(f"entregas           = {c[0] if c else '(nenhuma)'}")
        print(f"kill_switch        = {'ATIVO' if KILL_SWITCH.exists() else 'inativo'}")
        if args.entry:
            # Distingue "o save nunca criou a obrigação" de "a obrigação existe e ninguém a
            # consumiu". São causas opostas com o mesmo sintoma — nenhum e-mail na caixa — e
            # tratar uma pela outra faz perder tempo no lugar errado.
            st = m8m9.status(f"cdb2026:entry-saved-confirmation:{args.entry}:v1")
            print(f"evento_da_entrada  = {st or 'NAO EXISTE (o save não criou obrigação)'}")
        return 0

    if not args.run:
        ap.print_help()
        return 2

    m8m9.recover_expired_leases()
    owner = f"entry-saved-consumer@{os.uname().nodename}:{os.getpid()}"
    total_chamadas = 0
    for _ in range(args.max):
        resultado, chamadas = processa_um(owner)
        total_chamadas += chamadas
        if resultado == "SEM_EVENTO":
            break
    print(f"chamadas_ao_provedor = {total_chamadas}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
