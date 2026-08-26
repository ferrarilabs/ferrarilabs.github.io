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


def entity_from_key(chave: str) -> str:
    """Extrai `fase:confronto:perna` de uma chave de idempotência deste pool.

    Existe porque `bolao_notif_status_by_pool` devolve APENAS `(idempotency_key, status)` — não há
    coluna `entity_id`. O leitor daqui pedia `r["entity_id"]`, recebia `None` para toda linha e
    devolvia sempre um conjunto vazio: nenhuma entrega jamais era reconhecida, então o vigia não
    tinha como reportar `HEALTHY` nem com o ledger perfeito. Terceiro defeito da Issue #352, da
    mesma família dos outros dois — o adaptador conversando com uma RPC que ele não leu.

    A chave já carrega a identidade: `<pool>:<evento>:<fase>:<confronto>:<perna>:<entry_ref>`.
    """
    prefixo = f"{POOL_ID}:{EVENT_TYPE}:"
    if not chave.startswith(prefixo):
        return ""
    partes = chave[len(prefixo):].split(":")
    return ":".join(partes[:3]) if len(partes) >= 4 else ""


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
        self._job_ids = {}      # idempotency_key -> job_id (uuid), preenchido pelo `reserve()`

    # ── escrita (fail-open, sempre) ──────────────────────────────────────────────────────────
    def reserve(self, phase_id, tie_id, leg, recipients, payload=None) -> dict:
        """Cria uma linha por destinatário. Devolve o que conseguiu, e NUNCA levanta."""
        criadas, falhas = [], []
        for entry_ref in recipients:
            key = idempotency_key(phase_id, tie_id, leg, entry_ref)
            try:
                # `recipients` NAO e enfeite: `set_bolao_notif_recipient` atualiza a disposicao
                # DENTRO deste array, e `settle_bolao_notif` deriva o status do job contando
                # ACCEPTED sobre o total. Sem o array, o settle veria `total = 0` e concluiria
                # "nenhum destinatario aceito" -- job eternamente `failed_retryable`, entrega real
                # nenhuma vez registrada. E a forma canonica que o Powerball ja usa.
                corpo = dict(payload or {})
                corpo["recipients"] = [{"entryRef": entry_ref, "state": "PENDING"}]
                job_id = self._rpc("enqueue_bolao_notif", {
                    "p_pool_id": POOL_ID,
                    "p_entity_id": entity_id(phase_id, tie_id, leg),
                    "p_event_type": EVENT_TYPE,
                    "p_event_version": 1,
                    "p_entry_ref": entry_ref,
                    "p_idempotency_key": key,
                    "p_payload": corpo,
                    "p_template_id": TEMPLATE_ID,
                    "p_template_version": 1,
                    "p_max_attempts": 1,
                    "p_schema_version": SCHEMA_VERSION,
                })
                # O UUID devolvido e a identidade canonica do job. Guardar era o que faltava:
                # `mark_sent()` chegava a `mark_bolao_notif_sent` sem ele e passava um hash de
                # conteudo no lugar.
                self._job_ids[key] = job_id
                criadas.append(key)
            except Exception as ex:  # noqa: BLE001 — fail-open é o contrato deste módulo
                falhas.append(f"{entry_ref}: {ex}")
        if falhas:
            self._log(f"  LEDGER_DEGRADED reserve — {len(falhas)} de {len(recipients)} não registradas; "
                      f"o envio CONTINUA. {falhas[0]}")
        return {"reserved": criadas, "failed": falhas}

    def mark_sent(self, phase_id, tie_id, leg, entry_ref, provider_message_id=None) -> bool:
        """Registra a entrega pelo caminho CANÔNICO — o mesmo que o Powerball usa.

        ─── O QUE ESTAVA ERRADO AQUI (Issue #352) ───────────────────────────────────────────────

        Isto chamava `mark_bolao_notif_sent(p_job_id=...)` passando o retorno de
        `get_bolao_notif_content_hash`, que é o `contentHash` (texto) e não o UUID do job. E ainda
        que o UUID estivesse certo, aquela RPC só atualiza linha em `status = 'processing'`,
        enquanto `enqueue` cria em `'pending'` — o `update` casava zero linhas.

        Pior que errar: errar em silêncio. O `try` devolvia `True` porque a chamada não levantou,
        então o remetente registrava "entrega marcada" para uma linha que nunca saiu de `pending`.
        Foi exatamente isso em 2026-08-26: 12 e-mails entregues, 12 linhas `pending`, zero `sent`,
        e o vigia acusando `GAP` de uma notificação que o participante tinha recebido.

        ─── O CAMINHO CERTO ─────────────────────────────────────────────────────────────────────

        `set_bolao_notif_recipient` grava a disposição do destinatário e **levanta** quando não casa
        job nenhum (a própria migração comenta que 0 linhas não é sucesso silencioso). Depois,
        `settle_bolao_notif` deriva o status do job: só vira `sent` quando TODOS os destinatários
        estão `ACCEPTED`; parcial vira `failed_retryable` e qualquer `UNCERTAIN` trava para revisão.

        Devolve `True` somente quando o banco CONFIRMA `sent`. Nunca porque a chamada não levantou.
        """
        chave = idempotency_key(phase_id, tie_id, leg, entry_ref)
        try:
            self._rpc("set_bolao_notif_recipient", {
                "p_idempotency_key": chave, "p_entry_ref": entry_ref,
                "p_state": "ACCEPTED",
                "p_provider_message_id": str(provider_message_id or ""), "p_error": None,
            })
            r = self._rpc("settle_bolao_notif", {"p_idempotency_key": chave})
            linha = (r[0] if isinstance(r, list) and r else (r or {})) or {}
            status = (linha.get("status") or "").lower()
            if status != "sent":
                self._log(f"  LEDGER_DEGRADED mark_sent {entry_ref}: o job liquidou como "
                          f"`{status or 'desconhecido'}`, não `sent` — o e-mail JÁ FOI enviado; "
                          f"só o registro não fechou.")
                return False
            return True
        except Exception as ex:  # noqa: BLE001
            self._log(f"  LEDGER_DEGRADED mark_sent {entry_ref}: {ex} — o e-mail JÁ FOI enviado; só o registro falhou.")
            return False

    def mark_failed(self, phase_id, tie_id, leg, entry_ref, erro="") -> bool:
        """Provedor recusou: a disposição vira `FAILED` e o job liquida como falha recuperável.

        Sem isto, uma falha de provedor deixava a linha em `pending` — indistinguível de uma
        reserva que nunca chegou a tentar, que é o estado ambíguo que bloqueia recuperação depois.
        """
        chave = idempotency_key(phase_id, tie_id, leg, entry_ref)
        try:
            self._rpc("set_bolao_notif_recipient", {
                "p_idempotency_key": chave, "p_entry_ref": entry_ref,
                "p_state": "FAILED", "p_provider_message_id": None, "p_error": str(erro or "")[:120],
            })
            self._rpc("settle_bolao_notif", {"p_idempotency_key": chave})
            return True
        except Exception as ex:  # noqa: BLE001
            self._log(f"  LEDGER_DEGRADED mark_failed {entry_ref}: {ex}")
            return False

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
            ent = entity_from_key(r.get("idempotency_key") or "")
            if ent:
                out.add(ent)
        return out
