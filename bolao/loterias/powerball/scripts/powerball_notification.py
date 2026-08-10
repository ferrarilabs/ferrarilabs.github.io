"""
powerball_notification.py — ledger durável de notificação do Powerball.

Adaptador de domínio sobre `bolao_notif_jobs` (migração 010, aplicada em produção no F7). NÃO
cria um segundo subsistema de notificação, e NÃO força o Powerball em conceitos de futebol —
rodada, manifesto, lote de jogos não existem aqui.

  camada compartilhada : claim/lease atômico, idempotência, disposição por destinatário
  camada Powerball     : identidade de sorteio, números sorteados, prêmio, e-mail de resultado

─── O DEFEITO QUE ISTO FECHA ───────────────────────────────────────────────────────────────────

`send_result_email.py` calculava um `logicalSendId` determinístico e **nunca o persistia**. Ele
vivia em memória, dentro de uma execução. Nada registrava que o e-mail daquele sorteio tinha
saído, então a única proteção contra reenvio era a pergunta "o sorteio já tem resultado?" — que é
uma pergunta sobre o RESULTADO, não sobre a NOTIFICAÇÃO.

Com o cron de meia em meia hora isso é um caminho direto para 15 pessoas receberem duas vezes:
a execução A grava e envia, o commit demora, a execução B lê o estado antigo e envia de novo. E
se o provedor aceitar e o processo morrer antes de persistir, nada no sistema sabe que já enviou.

─── SEPARAÇÃO OBRIGATÓRIA ──────────────────────────────────────────────────────────────────────

    resultado reconciliado  ≠  notificação concluída

Um resultado válido pode ficar gravado enquanto a notificação segue pendente — por exemplo com o
conjunto de destinatários incompleto. E falha de notificação NUNCA é motivo para reverter um
resultado oficial legítimo.

─── GARANTIA DE ENTREGA (declarada, não presumida) ─────────────────────────────────────────────

O EmailJS não expõe consulta por idempotência. Na janela entre o provedor aceitar e a persistência
acontecer, não dá para distinguir localmente "enviado" de "não enviado". Por destinatário:

    AT_MOST_ONCE até o aceite; UNCERTAIN_AFTER_PROVIDER_ACCEPT depois.

Destinatário em UNCERTAIN **não** é reenviado automaticamente. Reenviar porque a transação local
se perdeu é exatamente como se manda o mesmo e-mail duas vezes.
"""

import json
import os
import subprocess
import tempfile
import urllib.request
from datetime import datetime, timezone

POOL = "powerball"
SUPABASE_URL = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON_KEY = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))

DELIVERY_SEMANTICS = "AT_MOST_ONCE_UNTIL_ACCEPT/UNCERTAIN_AFTER_PROVIDER_ACCEPT"

# Estados de NOTIFICAÇÃO. Independentes do estado do RESULTADO.
PENDING = "pending"
CLAIMED = "processing"
SENT = "sent"
FAILED_RETRYABLE = "failed_retryable"
FAILED_PERMANENT = "failed_permanent"

# Disposição por destinatário, guardada no payload do job (nunca endereço).
R_PENDING = "PENDING"
R_SENDING = "SENDING"
R_ACCEPTED = "ACCEPTED"
R_FAILED = "FAILED"
R_UNCERTAIN = "UNCERTAIN"


def draw_key(draw_id):
    """Identidade determinística. Nunca contém e-mail nem nome."""
    if not draw_id or "@" in str(draw_id):
        raise ValueError("draw_id invalido")
    return f"powerball:draw-result:{draw_id}:v1"


def recipient_key(draw_id, entry_ref):
    if not entry_ref or "@" in str(entry_ref):
        raise ValueError("entry_ref precisa ser opaco, nunca um endereco")
    return f"{draw_key(draw_id)}#{entry_ref}"


def content_hash(draw_id, result, recipient_refs, finance=None):
    """Cobre identidade do sorteio, números, prêmio e conjunto de destinatários.

    Se uma execução posterior calcular conteúdo diferente para um job já ativo, isso é
    CONTENT_CONFLICT — não uma atualização.
    """
    import hashlib
    payload = {
        "draw": draw_id,
        "numbers": sorted(result.get("numbers") or []),
        "special": result.get("special"),
        "multiplier": result.get("multiplier"),
        "recipients": sorted(str(r) for r in recipient_refs),
        "finance": finance or {},
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:32]


# ── Acesso ao banco ───────────────────────────────────────────────────────────
def _rpc(name, args):
    """RPC anônima (as de leitura/enqueue são chamáveis por desenho)."""
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/{name}", data=json.dumps(args).encode(), method="POST",
        headers={"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}",
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def _sql(statement):
    """Execução privilegiada via sessão da CLI do Supabase. Credencial nunca é impressa."""
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as fh:
        fh.write(statement + "\n")
        caminho = fh.name
    try:
        proc = subprocess.run(
            ["npx", "--yes", "supabase@latest", "db", "query", "--linked", "--file", caminho],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=180)
        if proc.returncode != 0:
            raise RuntimeError(f"SQL falhou: {(proc.stderr or proc.stdout)[:250]}")
        return proc.stdout
    finally:
        os.unlink(caminho)


def ledger_available():
    """(disponivel, motivo). Envio real EXIGE isto — sem ledger não há idempotência durável."""
    try:
        _rpc("bolao_notif_health", {"p_pool_id": POOL})
        return True, None
    except Exception as e:
        return False, f"{type(e).__name__}: {str(e)[:80]}"


def get_job(draw_id):
    """Estado atual do job daquele sorteio, ou None."""
    linhas = _rpc("bolao_notif_status_by_pool", {"p_pool_id": POOL}) or []
    chave = draw_key(draw_id)
    for l in linhas:
        if l["idempotency_key"] == chave:
            return {"idempotencyKey": chave, "status": l["status"]}
    return None


def ensure_job(draw_id, result, recipient_refs, finance=None):
    """Cria (ou reencontra) o job da notificação daquele sorteio.

    Só deve ser chamado DEPOIS de: identidade do sorteio conferida, portão temporal vencido,
    resultado validado e conflito de resultado descartado. Criar o job antes disso registraria
    intenção de comunicar algo que ainda não se sabe verdadeiro.
    """
    chave = draw_key(draw_id)
    ch = content_hash(draw_id, result, recipient_refs, finance)
    existente = get_job(draw_id)

    if existente and existente["status"] == SENT:
        return {"key": chave, "status": SENT, "created": False, "contentHash": ch}

    payload = json.dumps({
        "drawId": draw_id,
        "contentHash": ch,
        "recipients": [{"entryRef": r, "state": R_PENDING} for r in sorted(recipient_refs)],
        "expectedRecipientCount": len(recipient_refs),
        "deliverySemantics": DELIVERY_SEMANTICS,
    }).replace("'", "''")

    _sql(f"select enqueue_bolao_notif('{POOL}', '{draw_id}', 'draw-result', 1, "
         f"'AGGREGATE', '{chave}', '{payload}'::jsonb, 'powerball-result', 1, 5, 1);")
    return {"key": chave, "status": (existente or {}).get("status", PENDING),
            "created": existente is None, "contentHash": ch}


def check_content_immutability(draw_id, result, recipient_refs, finance=None):
    """(ok, motivo). Job ativo com conteúdo diferente é conflito, não atualização."""
    existente = get_job(draw_id)
    if not existente or existente["status"] == PENDING:
        return True, None
    esperado = content_hash(draw_id, result, recipient_refs, finance)
    saida = _sql(f"select payload_snapshot->>'contentHash' as h from bolao_notif_jobs "
                 f"where idempotency_key = '{draw_key(draw_id)}';")
    if esperado not in saida:
        return False, "CONTENT_CONFLICT: job ativo com conteudo diferente do calculado agora"
    return True, None


def claim(draw_id, worker, lease_seconds=600):
    """Reivindicação ATÔMICA. A exclusividade vem do `for update skip locked` no banco."""
    linhas = _rpc("claim_bolao_notif", {"p_pool_id": POOL, "p_worker": worker,
                                        "p_limit": 10, "p_lease_seconds": lease_seconds})
    chave = draw_key(draw_id)
    for l in linhas or []:
        if l.get("idempotency_key") == chave:
            return l
    return None


def record_recipient(draw_id, entry_ref, state, provider_message_id=None, error=None):
    """Disposição de UM destinatário. Endereço nunca entra aqui — só a referência opaca."""
    if "@" in str(entry_ref):
        raise ValueError("entry_ref precisa ser opaco")
    patch = json.dumps({"state": state, "providerMessageId": provider_message_id,
                        "lastError": (error or "")[:120]}).replace("'", "''")
    _sql(f"""
update bolao_notif_jobs
   set payload_snapshot = jsonb_set(payload_snapshot, '{{recipients}}',
     (select coalesce(jsonb_agg(case when r->>'entryRef' = '{entry_ref}'
                                     then r || '{patch}'::jsonb else r end order by ord), '[]'::jsonb)
      from jsonb_array_elements(payload_snapshot->'recipients') with ordinality as t(r, ord)))
 where idempotency_key = '{draw_key(draw_id)}';""")


def settle(draw_id):
    """Deriva o estado do JOB a partir das disposições por destinatário.

    Parcial NUNCA vira concluído; qualquer UNCERTAIN trava para revisão humana.
    """
    saida = _sql(f"select payload_snapshot->'recipients' as r from bolao_notif_jobs "
                 f"where idempotency_key = '{draw_key(draw_id)}';")
    try:
        dados = json.loads(saida[saida.index("{"):saida.rindex("}") + 1])
        recs = dados.get("rows", [{}])[0].get("r") or []
    except Exception:
        recs = []
    total = len(recs)
    aceitos = sum(1 for r in recs if r.get("state") == R_ACCEPTED)
    incertos = sum(1 for r in recs if r.get("state") == R_UNCERTAIN)

    if incertos:
        novo, motivo = FAILED_PERMANENT, "NOTIFICATION_UNCERTAIN: requer revisao humana"
    elif total and aceitos == total:
        novo, motivo = SENT, None
    elif aceitos:
        novo, motivo = FAILED_RETRYABLE, "PARTIAL: nem todos aceitos"
    else:
        novo, motivo = FAILED_RETRYABLE, "nenhum destinatario aceito"

    _sql(f"update bolao_notif_jobs set status = '{novo}'::bolao_notif_status, "
         f"sent_at = case when '{novo}' = 'sent' then now() else sent_at end, "
         f"last_error = {'null' if not motivo else repr(motivo).replace(chr(34), chr(39))}, "
         f"claimed_by = null, lease_expires_at = null "
         f"where idempotency_key = '{draw_key(draw_id)}';")
    return {"status": novo, "accepted": aceitos, "total": total, "uncertain": incertos,
            "reason": motivo}


def reconcile_orphaned_sending(draw_id):
    """SENDING orfao -> UNCERTAIN. Chamado ao reassumir um job cujo dono morreu.

    Um destinatario em SENDING significa: o transporte foi iniciado e o processo morreu antes de
    registrar o desfecho. NAO se sabe se o provedor aceitou. As duas leituras otimistas sao
    erradas:

      tratar como reenviavel  -> manda o mesmo e-mail duas vezes para quem ja recebeu
      tratar como aceito      -> declara entregue algo que talvez nunca tenha saido

    UNCERTAIN e a unica leitura honesta, e UNCERTAIN nao e reenviado automaticamente -- vai para
    revisao humana. Devolve quantos foram reconciliados.
    """
    saida = _sql(f"select payload_snapshot->'recipients' as r from bolao_notif_jobs "
                 f"where idempotency_key = '{draw_key(draw_id)}';")
    try:
        dados = json.loads(saida[saida.index("{"):saida.rindex("}") + 1])
        recs = dados.get("rows", [{}])[0].get("r") or []
    except Exception:
        return 0
    orfaos = [r["entryRef"] for r in recs if r.get("state") == R_SENDING]
    for ref in orfaos:
        record_recipient(draw_id, ref, R_UNCERTAIN,
                         error="transporte interrompido: desfecho desconhecido")
    return len(orfaos)


def retryable_recipients(draw_id):
    """Só quem é SEGURO reenviar. ACCEPTED e UNCERTAIN ficam de fora, sempre."""
    saida = _sql(f"select payload_snapshot->'recipients' as r from bolao_notif_jobs "
                 f"where idempotency_key = '{draw_key(draw_id)}';")
    try:
        dados = json.loads(saida[saida.index("{"):saida.rindex("}") + 1])
        recs = dados.get("rows", [{}])[0].get("r") or []
    except Exception:
        return []
    return [r["entryRef"] for r in recs
            if r.get("state") in (R_PENDING, R_FAILED)]
