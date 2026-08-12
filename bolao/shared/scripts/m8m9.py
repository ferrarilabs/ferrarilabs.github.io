"""Ponte de aplicação para M8 (audit_events) e M9 (outbox_events).

UMA AUTORIDADE DE TRANSPORTE, NÃO DUAS
--------------------------------------
A plataforma já tem semântica madura de entrega POR DESTINATÁRIO (o ledger durável: claim/lease,
ACCEPTED/FAILED/UNCERTAIN, `AT_MOST_ONCE_UNTIL_ACCEPT`). Este módulo NÃO a substitui e não fala
com provedor nenhum.

A divisão é:

    outbox_events   a OBRIGAÇÃO DE NOTIFICAR, no nível do evento de negócio.
                    "o resultado do sorteio 2026-08-12 precisa ser comunicado" — uma linha.
    ledger          QUEM recebeu, com que desfecho. Continua sendo o dono do provedor.
    audit_events    o que aconteceu, encadeado e imutável.

Se os dois pudessem enviar, existiriam dois caminhos para o mesmo e-mail e nenhuma garantia de
que só um roda. Por isso o outbox aqui envolve o envio; nunca o duplica.

O LIMITE TRANSACIONAL — DECLARADO, NÃO ESCONDIDO
------------------------------------------------
O ideal do padrão outbox é a mutação de negócio e o evento commitarem JUNTOS. Aqui não commitam:
o estado de negócio é um documento JSON gravado por REST em `bolao_state`, e o evento é uma linha
noutra transação. Não existe transação comum entre os dois.

O equivalente seguro é a chave de idempotência ser DERIVADA DO ESTADO, não gerada no momento.
Consequência exata:

    mutação commitou, processo caiu antes do outbox
        -> a execução seguinte recomputa a MESMA chave e insere. Obrigação recuperada.
    outbox inserido, mutação não commitou
        -> a chave descreve um estado que não existe; o consumidor não acha o que enviar e o
           evento morre em `dead` sem contatar ninguém.

Ou seja: perde-se atomicidade e ganha-se convergência. A obrigação nunca some em silêncio — que é
o modo de falha que o outbox existe para eliminar. O que ela pode fazer é chegar tarde.

SEM FALLBACK SILENCIOSO
-----------------------
Nada aqui engole erro. Se a auditoria não grava, o chamador fica sabendo. Um caminho de auditoria
que falha em silêncio é pior que não ter auditoria: passa a impressão de registro onde não há.
"""
import json
import os
import urllib.error
import urllib.request
import uuid

SUPABASE_URL = "https://cmhqkkfczotdnssupkni.supabase.co"


class M8M9Error(RuntimeError):
    """Falha na ponte. Nunca é engolida — ver 'SEM FALLBACK SILENCIOSO' acima."""


def _key():
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        raise M8M9Error(
            "SUPABASE_SERVICE_ROLE_KEY ausente — a ponte M8/M9 é concedida SOMENTE a service_role. "
            "Cair para a chave anon devolveria 401 e transformaria 'não posso registrar' em "
            "'nada a registrar'."
        )
    return k


def _rpc(nome, args):
    k = _key()
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/rpc/{nome}",
                                 data=json.dumps(args).encode(), headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt.strip() else None
    except urllib.error.HTTPError as e:
        corpo = e.read().decode()[:300]
        raise M8M9Error(f"{nome} falhou: http={e.code} {corpo}") from None
    except Exception as e:
        raise M8M9Error(f"{nome} inalcançável: {type(e).__name__}: {e}") from None


def new_correlation_id():
    """Um id por EXECUÇÃO. É o que permite reconstruir uma operação inteira depois."""
    return str(uuid.uuid4())


# ── M8 ───────────────────────────────────────────────────────────────────────────────────────
def emit_audit(action, aggregate_type, aggregate_key=None, metadata=None,
               correlation_id=None, reason=None, source="github_actions"):
    """Registra o que aconteceu. `action` tem de casar '^[a-z_]+\\.[a-z_]+$'.

    `metadata` vai para `safe_metadata` e é PÚBLICA para quem lê a auditoria: contagens, ids
    opacos, estados. NUNCA endereço, token, código de pagamento ou chave. Existe um sidecar
    (`audit_event_details`) para detalhe sensível; nada aqui o usa, porque nada aqui precisa.
    """
    return _rpc("emit_audit_event", {
        "p_action": action,
        "p_aggregate_type": aggregate_type,
        "p_aggregate_key": aggregate_key,
        "p_source": source,
        "p_safe_metadata": metadata or {},
        "p_correlation_id": correlation_id,
        "p_reason": reason,
    })


# ── M9 ───────────────────────────────────────────────────────────────────────────────────────
def emit_outbox(idempotency_key, event_type, payload=None, correlation_id=None):
    """(outbox_event_id, created). `created=False` significa que a obrigação já existia."""
    r = _rpc("emit_outbox_event", {
        "p_idempotency_key": idempotency_key,
        "p_event_type": event_type,
        "p_payload": payload or {},
        "p_channel": "email",
        "p_correlation_id": correlation_id,
    })
    if not r:
        raise M8M9Error(f"emit_outbox_event nao devolveu linha para {idempotency_key}")
    return r[0]["outbox_event_id"], r[0]["created"]


def claim(lease_owner, event_type=None, lease_seconds=900):
    """Reivindica um evento elegível, ou None. Atômico (for update skip locked no servidor)."""
    r = _rpc("claim_outbox_event", {
        "p_lease_owner": lease_owner,
        "p_lease_seconds": lease_seconds,
        "p_event_type": event_type,
    })
    return r[0] if r else None


def settle(outbox_event_id, outcome, provider_message_id=None, failure_category=None):
    """Devolve o novo estado. Liquidar o que não está in_flight é RECUSADO pelo banco."""
    return _rpc("settle_outbox_event", {
        "p_outbox_event_id": outbox_event_id,
        "p_outcome": outcome,
        "p_provider_message_id": provider_message_id,
        "p_failure_category": failure_category,
    })


def recover_expired_leases():
    """Worker que morreu entre reivindicar e liquidar não pode prender a linha para sempre."""
    return _rpc("recover_expired_outbox_leases", {})


def status(idempotency_key):
    r = _rpc("outbox_event_status", {"p_idempotency_key": idempotency_key})
    return r[0] if r else None


# ── Chaves de negócio ────────────────────────────────────────────────────────────────────────
#
# Determinísticas e derivadas do ESTADO — é isso que faz a obrigação sobreviver a uma queda entre
# a mutação e o registro (ver "O LIMITE TRANSACIONAL" acima). Gerar com timestamp ou uuid quebraria
# a recuperação: cada execução criaria uma obrigação nova para o mesmo fato.
#
# O sufixo de versão existe para quando o CONTEÚDO muda de forma que justifique reenviar. Mudar de
# v1 para v2 é uma decisão de negócio deliberada, nunca um efeito colateral de refatoração.
def key_powerball_result(draw_id, version=1):
    return f"powerball:draw-result:{draw_id}:v{version}"


def key_br_round(round_id, version=1):
    return f"br2026:round-results:{round_id}:v{version}"


def key_cdb_picks_open(phase_id, year=2026, version=1):
    return f"cdb2026:{phase_id}-picks-open:{year}:v{version}"


def key_cdb_result(phase_id, tie_id, leg, version=1):
    return f"cdb2026:result:{phase_id}:{tie_id}:{leg}:v{version}"


# ── Observabilidade (§28) ────────────────────────────────────────────────────────────────────
def automation_run(**campos):
    """Uma linha por execução, chaves estáveis, sem PII. Feita para grep, não para leitura bonita."""
    print("AUTOMATION_RUN " + " ".join(f"{k}={v}" for k, v in campos.items() if v is not None))
