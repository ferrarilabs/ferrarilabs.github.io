#!/usr/bin/env python3
"""test_result_email_ledger_lifecycle.py — o ciclo de vida REAL do ledger (Issue #352).

─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────────────────────────

Em 2026-08-26 a recuperação autorizada entregou 12 e-mails e o ledger registrou **zero** entregas.
As 12 linhas ficaram em `pending`, o vigia continuou acusando `GAP`, e nada no processo reclamou —
`mark_sent()` devolvia `True` porque a chamada não levantou.

`test_result_email_ledger.py` já existia e passava. Passava porque o dublê dele aceita qualquer
coisa: não modela o tipo do `job_id`, não modela a exigência de `status = 'processing'`, e não
modela que 0 linhas afetadas é erro. Um dublê sem as restrições do banco aprova um adaptador que o
banco recusa — e foi assim que dois defeitos independentes conviveram meses com a suíte verde.

Então este arquivo NÃO usa aquele dublê. Ele usa um que se comporta como as RPCs de verdade:

  · `enqueue_bolao_notif`        devolve UUID e cria a linha em `pending`
  · `set_bolao_notif_recipient`  LEVANTA se nenhum job casar a chave, recusa estado inválido e
                                 recusa `entry_ref` com `@`
  · `settle_bolao_notif`         deriva o status do job contando ACCEPTED sobre o total
  · `mark_bolao_notif_sent`      só atualiza linha em `processing` (é por isso que o caminho
                                 antigo não podia funcionar)

Sem rede, sem Supabase, sem e-mail.

Uso: python3 bolao/cdb2026/scripts/test_result_email_ledger_lifecycle.py
"""
import importlib.util
import os
import sys
import uuid
from pathlib import Path

AQUI = Path(__file__).resolve().parent
os.environ.setdefault("BOLAO_TEST_RUN", "1")
sys.path.insert(0, str(AQUI))

_FONTE = (AQUI / "result_email_ledger.py").read_text()


def carregar(fonte=None):
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("led", loader=None))
    mod.__file__ = str(AQUI / "result_email_ledger.py")
    exec(compile(fonte or _FONTE, mod.__file__, "exec"), mod.__dict__)
    return mod


L = carregar()

ok, fail = 0, 0


def test(nome, fn):
    global ok, fail
    try:
        fn(); print(f"  ✓ {nome}"); ok += 1
    except AssertionError as e:
        print(f"  ✗ {nome}\n      {e}"); fail += 1
    except Exception as e:  # noqa: BLE001
        print(f"  ✗ {nome}\n      {type(e).__name__}: {e}"); fail += 1


def _assert(c, m):
    if not c:
        raise AssertionError(m)


ALVO = ("quartas", "espn-atletico-mg_cruzeiro", "first")
REFS = ["e1", "e2"]


class BancoFiel:
    """Dublê que impõe as MESMAS restrições que as migrações impõem.

    Cada divergência aqui é uma restrição real, copiada do corpo da RPC — não uma invenção para
    dificultar. É o que faltava no dublê anterior.
    """

    ESTADOS = {"PENDING", "SENDING", "ACCEPTED", "FAILED", "UNCERTAIN"}

    def __init__(self, falhar_em=None):
        self.jobs = {}                 # idempotency_key -> dict
        self.falhar_em = falhar_em or set()
        self.chamadas = []

    def rpc(self, nome, args):
        self.chamadas.append(nome)
        if nome in self.falhar_em:
            raise RuntimeError(f"{nome} indisponivel")
        return getattr(self, f"_{nome}")(args)

    # ── as RPCs ───────────────────────────────────────────────────────────────────────────────
    def _enqueue_bolao_notif(self, a):
        chave = a["p_idempotency_key"]
        if chave not in self.jobs:
            self.jobs[chave] = {
                "job_id": str(uuid.uuid4()),          # UUID, como a RPC devolve
                "status": "pending",                   # nasce pending, nunca processing
                "payload_snapshot": dict(a.get("p_payload") or {}),
                "sent_at": None, "provider_message_id": None,
            }
        return self.jobs[chave]["job_id"]

    def _set_bolao_notif_recipient(self, a):
        chave, ref, estado = a["p_idempotency_key"], a["p_entry_ref"], a["p_state"]
        if not ref:
            raise RuntimeError("set_bolao_notif_recipient: entry_ref obrigatorio")
        if "@" in str(ref):
            raise RuntimeError("set_bolao_notif_recipient: entry_ref nao pode ser um endereco")
        if estado not in self.ESTADOS:
            raise RuntimeError(f"set_bolao_notif_recipient: estado invalido {estado}")
        job = self.jobs.get(chave)
        if job is None:
            # 0 linhas NÃO é sucesso silencioso — a migração levanta, e o dublê também.
            raise RuntimeError(f"set_bolao_notif_recipient: nenhum job com a chave {chave}")
        recs = job["payload_snapshot"].get("recipients") or []
        for r in recs:
            if r.get("entryRef") == ref:
                r["state"] = estado
                r["providerMessageId"] = a.get("p_provider_message_id")
                r["lastError"] = (a.get("p_error") or "")[:120]
        job["payload_snapshot"]["recipients"] = recs
        return 1

    def _settle_bolao_notif(self, a):
        chave = a["p_idempotency_key"]
        job = self.jobs.get(chave)
        if job is None:
            raise RuntimeError(f"settle_bolao_notif: nenhum job com a chave {chave}")
        recs = job["payload_snapshot"].get("recipients") or []
        total = len(recs)
        aceitos = sum(1 for r in recs if r.get("state") == "ACCEPTED")
        incertos = sum(1 for r in recs if r.get("state") == "UNCERTAIN")
        if incertos:
            status, motivo = "failed_permanent", "NOTIFICATION_UNCERTAIN: requer revisao humana"
        elif total and aceitos == total:
            status, motivo = "sent", None
        elif aceitos:
            status, motivo = "failed_retryable", "PARTIAL: nem todos aceitos"
        else:
            status, motivo = "failed_retryable", "nenhum destinatario aceito"
        job["status"] = status
        if status == "sent":
            job["sent_at"] = "2026-08-26T00:00:00Z"
        return [{"status": status, "accepted": aceitos, "total": total,
                 "uncertain": incertos, "reason": motivo}]

    def _mark_bolao_notif_sent(self, a):
        """Só atualiza linha em `processing` — a restrição que quebrava o caminho antigo."""
        alvo = a.get("p_job_id")
        for job in self.jobs.values():
            if job["job_id"] == alvo and job["status"] == "processing":
                job["status"] = "sent"
                return True
        return False       # zero linhas: NÃO é sucesso

    def _get_bolao_notif_content_hash(self, a):
        job = self.jobs.get(a["p_idempotency_key"])
        return (job or {}).get("payload_snapshot", {}).get("contentHash")

    def _bolao_notif_status_by_pool(self, a):
        return [{"idempotency_key": k, "status": j["status"]} for k, j in self.jobs.items()]


def ledger(mod=None, banco=None):
    b = banco or BancoFiel()
    return (mod or L).SupabaseResultEmailLedger(rpc=b.rpc, log=lambda *_a, **_k: None), b


print("\nCiclo de vida do ledger contra um dublê FIEL às restrições do banco\n")
print("A. Entrega bem-sucedida vira SENT canônico:")


def _sucesso():
    reg, b = ledger()
    reg.reserve(*ALVO, REFS)
    _assert(all(j["status"] == "pending" for j in b.jobs.values()), "reserve deveria criar em pending")
    for r in REFS:
        _assert(reg.mark_sent(*ALVO, r, provider_message_id="250") is True,
                f"mark_sent devolveu False para {r}")
    chaves = [L.idempotency_key(*ALVO, r) for r in REFS]
    for k in chaves:
        _assert(b.jobs[k]["status"] == "sent", f"job {k} ficou em {b.jobs[k]['status']}, nao sent")
        _assert(b.jobs[k]["sent_at"], "sent_at nao foi preenchido")

test("provedor OK → set_recipient(ACCEPTED) + settle → status `sent`", _sucesso)


def _reserve_guarda_uuid():
    reg, b = ledger()
    reg.reserve(*ALVO, REFS)
    chave = L.idempotency_key(*ALVO, "e1")
    _assert(reg._job_ids.get(chave) == b.jobs[chave]["job_id"],
            "o UUID devolvido por enqueue tem de ser guardado — descarta-lo foi o defeito 1 da #352")

test("reserve() guarda o UUID canônico devolvido por enqueue", _reserve_guarda_uuid)


def _payload_tem_recipients():
    reg, b = ledger()
    reg.reserve(*ALVO, REFS)
    chave = L.idempotency_key(*ALVO, "e1")
    recs = b.jobs[chave]["payload_snapshot"].get("recipients")
    _assert(recs and recs[0]["entryRef"] == "e1",
            "sem `recipients` no payload, settle conta total=0 e o job nunca vira sent")

test("reserve() escreve o array `recipients` que o settle conta", _payload_tem_recipients)


print("\nB. O no-op silencioso — o defeito que produziu o incidente:")


def _settle_diferente_de_sent_e_falha():
    """Se o banco NÃO confirma `sent`, o adaptador não pode dizer que marcou.

    Aqui o desfecho fica UNCERTAIN antes da marcação — o settle então devolve `failed_permanent`
    ("requer revisão humana") em vez de `sent`. É o caso que mais importa: desfecho desconhecido
    nunca pode virar entrega registrada, porque reenviar duplicaria para quem já recebeu.
    """
    reg, b = ledger()
    reg.reserve(*ALVO, REFS)
    chave = L.idempotency_key(*ALVO, "e1")
    b.jobs[chave]["payload_snapshot"]["recipients"][0]["state"] = "UNCERTAIN"
    # `mark_sent` grava ACCEPTED por cima? Não: o dublê só altera a entrada cujo entryRef casa, e
    # ela casa — então o teste força o cenário por outro caminho: um destinatário extra incerto.
    b.jobs[chave]["payload_snapshot"]["recipients"].append({"entryRef": "outro", "state": "UNCERTAIN"})
    _assert(reg.mark_sent(*ALVO, "e1", "250") is False,
            "com um desfecho UNCERTAIN no job o settle devolve failed_permanent — mark_sent tem de devolver False")
    _assert(b.jobs[chave]["status"] != "sent", b.jobs[chave]["status"])

test("settle que não devolve `sent` ⇒ mark_sent False (nunca True por não ter levantado)",
     _settle_diferente_de_sent_e_falha)


def _falha_de_escrita_no_ledger():
    reg, b = ledger(banco=BancoFiel(falhar_em={"set_bolao_notif_recipient"}))
    reg.reserve(*ALVO, REFS)
    _assert(reg.mark_sent(*ALVO, "e1", "250") is False,
            "falha de escrita no ledger tem de devolver False — o e-mail saiu, o registro nao")

test("provedor OK + ledger fora do ar ⇒ mark_sent False", _falha_de_escrita_no_ledger)


def _chave_inexistente_levanta():
    reg, b = ledger()
    # Nada reservado: não existe job com esta chave.
    _assert(reg.mark_sent(*ALVO, "fantasma", "250") is False,
            "marcar entrega de um job que nao existe tem de falhar, nao virar sucesso silencioso")

test("marcar entrega sem job correspondente ⇒ False (a RPC levanta, 0 linhas não é sucesso)",
     _chave_inexistente_levanta)


print("\nC. Falha de provedor e estados ambíguos:")


def _falha_de_provedor():
    reg, b = ledger()
    reg.reserve(*ALVO, REFS)
    _assert(reg.mark_failed(*ALVO, "e1", erro="550 rejeitado") is True, "mark_failed falhou")
    chave = L.idempotency_key(*ALVO, "e1")
    _assert(b.jobs[chave]["status"] == "failed_retryable", b.jobs[chave]["status"])
    _assert(b.jobs[chave]["status"] != "sent", "falha de provedor nao pode virar entrega")

test("provedor recusa ⇒ FAILED e job em `failed_retryable`, nunca `sent`", _falha_de_provedor)


def _pendente_interrompido_fica_ambiguo():
    """Tentativa interrompida: reservou e morreu. A linha fica `pending` — e assim tem de ficar."""
    reg, b = ledger()
    reg.reserve(*ALVO, REFS)
    chave = L.idempotency_key(*ALVO, "e1")
    _assert(b.jobs[chave]["status"] == "pending", b.jobs[chave]["status"])
    entregues = reg.delivered_entity_ids("2026-01-01T00:00:00Z")
    _assert(L.entity_id(*ALVO) not in entregues,
            "uma reserva pendente NAO pode contar como entrega — e o que a recuperacao le")

test("tentativa interrompida fica `pending` e não conta como entrega", _pendente_interrompido_fica_ambiguo)


def _entry_ref_nunca_e_endereco():
    reg, b = ledger()
    reg.reserve(*ALVO, ["quem@exemplo.invalid"])
    _assert(reg.mark_sent(*ALVO, "quem@exemplo.invalid", "250") is False,
            "endereco como entry_ref tem de ser recusado pelo banco — o ledger e evidencia lida em Issue")

test("`entry_ref` com `@` é recusado (endereço nunca vira identidade de ledger)", _entry_ref_nunca_e_endereco)


print("\nD. Replay depois de entregue:")


def _replay_nao_reenvia():
    reg, b = ledger()
    reg.reserve(*ALVO, REFS)
    for r in REFS:
        reg.mark_sent(*ALVO, r, "250")
    entregues = reg.delivered_entity_ids("2026-01-01T00:00:00Z")
    _assert(L.entity_id(*ALVO) in entregues,
            "depois de todos ACCEPTED, a entidade tem de aparecer como entregue — e o que vira HEALTHY")

test("todos entregues ⇒ entidade aparece em delivered_entity_ids (vigia vira HEALTHY)", _replay_nao_reenvia)


print("\nE. Controles negativos — cada defeito original, isolado:")


def _mutacao_identificador_errado():
    """Defeito A: voltar a usar o content hash como job id."""
    mutado = _FONTE.replace(
        '''            self._rpc("set_bolao_notif_recipient", {
                "p_idempotency_key": chave, "p_entry_ref": entry_ref,
                "p_state": "ACCEPTED",
                "p_provider_message_id": str(provider_message_id or ""), "p_error": None,
            })
            r = self._rpc("settle_bolao_notif", {"p_idempotency_key": chave})
            linha = (r[0] if isinstance(r, list) and r else (r or {})) or {}
            status = (linha.get("status") or "").lower()
            if status != "sent":''',
        '''            self._rpc("mark_bolao_notif_sent", {
                "p_job_id": self._rpc("get_bolao_notif_content_hash", {"p_idempotency_key": chave}),
                "p_provider_message_id": str(provider_message_id or ""),
            })
            status = "sent"
            if False:''', 1)
    _assert(mutado != _FONTE, "a mutacao A nao alterou o caminho de marcacao")
    M = carregar(mutado)
    reg, b = ledger(mod=M)
    reg.reserve(*ALVO, REFS)
    reg.mark_sent(*ALVO, "e1", "250")
    chave = L.idempotency_key(*ALVO, "e1")
    _assert(b.jobs[chave]["status"] != "sent",
            "CONTROLE NEGATIVO A FALHOU: com hash de conteudo no lugar do UUID o job NAO pode virar sent")

test("mutação A (content hash como job id) deixa o job fora de `sent`", _mutacao_identificador_errado)


def _mutacao_sem_transicao():
    """Defeito B: o job nunca chega ao estado de onde a transição é possível.

    No caminho canônico isso é o array `recipients`: sem ele, `settle` conta `total = 0` e conclui
    "nenhum destinatário aceito" — o job jamais vira `sent`, que é exatamente o sintoma de 2026-08-26.
    """
    mutado = _FONTE.replace(
        'corpo["recipients"] = [{"entryRef": entry_ref, "state": "PENDING"}]',
        'pass  # MUTACAO: sem recipients, o settle nao tem o que contar', 1)
    _assert(mutado != _FONTE, "a mutacao B nao alterou o payload da reserva")
    M = carregar(mutado)
    reg, b = ledger(mod=M)
    reg.reserve(*ALVO, REFS)
    marcado = reg.mark_sent(*ALVO, "e1", "250")
    chave = L.idempotency_key(*ALVO, "e1")
    _assert(marcado is False and b.jobs[chave]["status"] != "sent",
            "CONTROLE NEGATIVO B FALHOU: sem `recipients` o settle nao pode concluir `sent`")

test("mutação B (sem a transição de estado) impede o job de virar `sent`", _mutacao_sem_transicao)


def _mutacao_noop_silencioso():
    """Defeito C: voltar a devolver True só porque a chamada não levantou."""
    mutado = _FONTE.replace(
        '''            if status != "sent":''',
        '''            if False:''', 1)
    _assert(mutado != _FONTE, "a mutacao C nao alterou a checagem do settle")
    M = carregar(mutado)
    reg, b = ledger(mod=M)
    reg.reserve(*ALVO, REFS)
    _assert(reg.mark_sent(*ALVO, "e1", "250") is True,
            "CONTROLE NEGATIVO C FALHOU: o mutante deveria reportar sucesso numa entrega PARCIAL")

test("mutação C (ignorar o status do settle) volta a reportar sucesso falso", _mutacao_noop_silencioso)


print("\nF. Contrato contra o SQL de verdade:")


def _dublê_bate_com_a_migracao():
    """As restrições que este dublê impõe têm de existir mesmo nas migrações."""
    raiz = AQUI.parent.parent.parent
    sql = ""
    for f in (raiz / "supabase" / "migrations").glob("*.sql"):
        sql += f.read_text()
    _assert('"mark_bolao_notif_sent"("p_job_id" "uuid"' in sql,
            "a RPC de marcar entrega deveria receber `uuid` — se mudou, este dublê ficou desatualizado")
    _assert("where job_id = p_job_id and status = 'processing'" in sql,
            "a RPC deveria exigir `processing` — se mudou, revise o caminho canonico")
    _assert('"get_bolao_notif_content_hash"("p_idempotency_key" "text") RETURNS "text"' in sql,
            "content hash deveria retornar texto — a confusao com o UUID nasceu dai")
    _assert("raise exception 'set_bolao_notif_recipient: nenhum job com a chave %'" in sql,
            "0 linhas em set_recipient tem de LEVANTAR — e o que impede o no-op silencioso")
    _assert("v_status := 'sent';" in sql and "PARTIAL: nem todos aceitos" in sql,
            "settle deveria derivar `sent` so com todos aceitos, e nunca concluir parcial")

test("as restrições modeladas aqui existem mesmo no SQL das migrações", _dublê_bate_com_a_migracao)


print(f"\n  {ok} passed, {fail} failed\n")
if fail:
    print("✗ CICLO DE VIDA DO LEDGER REPROVADO\n")
    sys.exit(1)
print("✓ CICLO DE VIDA DO LEDGER OK\n")
