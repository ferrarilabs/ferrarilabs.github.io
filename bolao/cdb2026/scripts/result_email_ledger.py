#!/usr/bin/env python3
"""
LEDGER DURÁVEL DO E-MAIL DE RESULTADO DO CDB2026 — Issue #180.

─── O PROBLEMA QUE ISTO RESOLVE ─────────────────────────────────────────────────────────────────

`send_result_email.py --auto` sai com 0 tanto quando não havia nada a fazer quanto quando havia um
resultado e o envio foi perdido. No painel do Actions os dois casos são o mesmo verde. Foi assim que
o HIST-037 (2026-08-06) passou: duas partidas terminadas ficaram sem notificação por 3 a 27 horas, e
quem percebeu foi o dono, não o monitoramento.

Um detector precisa perguntar "houve envio para esta perna?" — e hoje **não existe nada
autoritativo para ler**. A única idempotência do caminho é o `client_ref` de
`cdb_apply_operator_mutation`, que deduplica MUTAÇÃO DE ESTADO, não envio de e-mail.

Este módulo é o registro que faltava. Ele NÃO é um segundo armazenamento: usa `bolao_notif_jobs`, a
mesma tabela que o BR2026 já usa, com `pool_id = 'cdb2026'`.

─── A REGRA QUE GOVERNA CADA LINHA AQUI: NUNCA ATRAPALHAR UM ENVIO LEGÍTIMO ──────────────────────

Toda escrita neste módulo é FAIL-OPEN. Se o banco estiver fora, se a RPC mudar de forma, se a
credencial faltar — o módulo registra o problema e **devolve o controle para que o e-mail seja
enviado assim mesmo**. Isso é deliberado e é a decisão de projeto mais importante do arquivo:

  o CDB2026 já teve um incidente de DUPLICATA (#221, rodada 23 enviada 4× para 11 participantes
  reais) e um incidente de AUSÊNCIA (HIST-037). Um portão que bloqueia o envio quando o ledger não
  responde troca o segundo problema pelo primeiro — e o primeiro é pior, porque chega ao
  participante.

Consequência honesta: a exatamente-uma-vez fica **preservada, não fortalecida**, quando o ledger
está indisponível — que é exatamente o que já acontece hoje. Quando ele responde, ganha-se uma
segunda guarda independente (`already_delivered`), que hoje não existe.

─── SEM BACKFILL. NUNCA. ────────────────────────────────────────────────────────────────────────

Nenhuma função aqui inventa registro de entrega para perna antiga. Um registro de entrega fabricado
**suprime um envio futuro legítimo**, e não há evidência autoritativa de quem recebeu o quê antes
desta adoção. Pernas anteriores a `LEDGER_ADOPTED_AT` são classificadas `PRE_LEDGER` pelo detector —
nem saudáveis nem falhas: fora de escopo, declaradamente.
"""

from __future__ import annotations

import json
import os
import urllib.request

# Pool no armazenamento compartilhado. `bolao_notif_jobs` já carrega br2026 e powerball.
POOL_ID = "cdb2026"
EVENT_TYPE = "RESULT_EMAIL"
TEMPLATE_ID = "cdb2026-result"
SCHEMA_VERSION = 1

# A partir de quando o detector pode concluir alguma coisa. Perna cujo resultado é anterior a isto
# não tem registro porque o registro não existia — não porque o envio falhou.
LEDGER_ADOPTED_AT = "2026-08-21T00:00:00Z"

# Folga antes de considerar que um envio deveria ter acontecido. Generosa de propósito: uma perna que
# termina na borda de uma janela de envio é NORMAL, e um detector apertado demais dispara todo dia,
# é silenciado, e aí não serve para nada — que é como o defeito original sobreviveu.
GRACE_HOURS = 3


def entity_id(phase_id: str, tie_id: str, leg: str) -> str:
    """Identidade de NEGÓCIO de um e-mail de resultado: fase, confronto, perna.

    Não é o assunto e não é o hash do conteúdo. Reenviar a mesma perna com o texto corrigido
    continua sendo a MESMA notificação; tratar conteúdo como identidade produziria um "novo" envio
    a cada ajuste de template, que é exatamente o vetor da duplicata da #221.
    """
    return f"{phase_id}:{tie_id}:{leg}"


def idempotency_key(phase_id: str, tie_id: str, leg: str, entry_ref: str) -> str:
    """Uma linha por (perna, destinatário) — o grão que `bolao_notif_jobs` já usa no BR2026."""
    return f"{POOL_ID}:{EVENT_TYPE}:{entity_id(phase_id, tie_id, leg)}:{entry_ref}"


class LedgerUnavailable(Exception):
    """O ledger não pôde ser LIDO. Distinto de 'não há registro' — ver o detector."""


def _rpc(name: str, payload: dict, *, url: str | None = None, key: str | None = None, timeout: int = 20):
    url = url or os.environ.get("SUPABASE_URL") or "https://cmhqkkfczotdnssupkni.supabase.co"
    key = key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not key:
        raise LedgerUnavailable("SUPABASE_SERVICE_ROLE_KEY ausente")
    req = urllib.request.Request(
        f"{url}/rest/v1/rpc/{name}",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read().decode()
    return json.loads(body) if body.strip() else None


class SupabaseResultEmailLedger:
    """Adaptador fino sobre as RPCs compartilhadas. Toda ESCRITA é fail-open; a LEITURA levanta."""

    def __init__(self, rpc=_rpc, log=print):
        self._rpc = rpc
        self._log = log

    # ── escrita (fail-open, sempre) ──────────────────────────────────────────────────────────
    def reserve(self, phase_id, tie_id, leg, recipients, payload=None) -> dict:
        """Cria uma linha por destinatário. Devolve o que conseguiu, e NUNCA levanta."""
        criadas, falhas = [], []
        for entry_ref in recipients:
            key = idempotency_key(phase_id, tie_id, leg, entry_ref)
            try:
                self._rpc("enqueue_bolao_notif", {
                    "p_pool_id": POOL_ID,
                    "p_entity_id": entity_id(phase_id, tie_id, leg),
                    "p_event_type": EVENT_TYPE,
                    "p_event_version": 1,
                    "p_entry_ref": entry_ref,
                    "p_idempotency_key": key,
                    "p_payload": payload or {},
                    "p_template_id": TEMPLATE_ID,
                    "p_template_version": 1,
                    "p_max_attempts": 1,
                    "p_schema_version": SCHEMA_VERSION,
                })
                criadas.append(key)
            except Exception as ex:  # noqa: BLE001 — fail-open é o contrato deste módulo
                falhas.append(f"{entry_ref}: {ex}")
        if falhas:
            self._log(f"  LEDGER_DEGRADED reserve — {len(falhas)} de {len(recipients)} não registradas; "
                      f"o envio CONTINUA. {falhas[0]}")
        return {"reserved": criadas, "failed": falhas}

    def mark_sent(self, phase_id, tie_id, leg, entry_ref, provider_message_id=None) -> bool:
        try:
            self._rpc("mark_bolao_notif_sent", {
                "p_job_id": self._job_id(phase_id, tie_id, leg, entry_ref),
                "p_provider_message_id": str(provider_message_id or ""),
            })
            return True
        except Exception as ex:  # noqa: BLE001
            self._log(f"  LEDGER_DEGRADED mark_sent {entry_ref}: {ex} — o e-mail JÁ FOI enviado; só o registro falhou.")
            return False

    def _job_id(self, phase_id, tie_id, leg, entry_ref):
        rec = self._rpc("get_bolao_notif_content_hash", {
            "p_idempotency_key": idempotency_key(phase_id, tie_id, leg, entry_ref)})
        return rec

    # ── leitura (levanta, para o detector poder dizer UNKNOWN) ───────────────────────────────
    def delivered_entity_ids(self, since_iso: str) -> set[str]:
        """`entity_id`s do CDB2026 com pelo menos uma entrega `sent`. Levanta se não puder ler."""
        try:
            rows = self._rpc("bolao_notif_status_by_pool", {"p_pool_id": POOL_ID}) or []
        except Exception as ex:  # noqa: BLE001
            raise LedgerUnavailable(str(ex)) from ex
        out = set()
        for r in rows:
            if (r.get("status") or "").lower() != "sent":
                continue
            ent = r.get("entity_id") or ""
            if ent:
                out.add(ent)
        return out
