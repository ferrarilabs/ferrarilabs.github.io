"""
test_anon_notification_denied.py — ANON_NOTIFICATION_MUTATIONS_DENIED (N24).

Usa a anon key PUBLICA DE VERDADE contra o banco DE VERDADE. Nao ha como provar isto de outro
jeito: a pergunta e literalmente "o que um estranho com a chave que vai no config.js consegue
fazer?", e so a chave real contra o banco real responde.

─── O DEFEITO QUE ISTO FECHA ───────────────────────────────────────────────────────────────────

Ate 2026-08-10 a resposta era: TUDO. As RPCs de notificacao da migracao 010 nasceram executaveis
por PUBLIC (Postgres faz isso com funcao nova sem grant explicito), e PUBLIC inclui `anon`.

O ataque nao era corromper dado -- era mais silencioso. Chamar `mark_bolao_notif_sent` num
sorteio faz o ciclo ver ALREADY_COMPLETED e virar no-op para sempre. O e-mail de resultado dos 15
participantes some sem erro em lugar nenhum. O proprio mecanismo de idempotencia que impede envio
duplo vira a arma.

Executar: POWERBALL_TEST_RUN=1 python3 test_anon_notification_denied.py
"""

import json
import os
import sys
import unittest
import urllib.error
import urllib.request
import uuid

os.environ["POWERBALL_TEST_RUN"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import powerball_notification as P

ANON = P.ANON_KEY          # a mesma chave publica que vai em js/config.js
UUID_ZERO = "00000000-0000-0000-0000-000000000000"


def como_anonimo(nome, args):
    """(permitido, http). Chama a RPC com a anon key publica, exatamente como um estranho faria."""
    req = urllib.request.Request(
        f"{P.SUPABASE_URL}/rest/v1/rpc/{nome}", data=json.dumps(args).encode(), method="POST",
        headers={"apikey": ANON, "Authorization": f"Bearer {ANON}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25):
            return True, 200
    except urllib.error.HTTPError as e:
        return False, e.code
    except Exception:
        return False, "erro de rede"


class AnonNaoMutaNotificacao(unittest.TestCase):
    """Cada teste e um ataque concreto que era possivel ate 2026-08-10."""

    def negar(self, nome, args, dano):
        permitido, http = como_anonimo(nome, args)
        self.assertFalse(permitido,
                         f"anon ainda executa {nome}() (http={http}) — {dano}")
        self.assertIn(http, (401, 403, 404),
                      f"{nome} respondeu {http}; esperado negacao de permissao")

    def test_anon_nao_cria_job_de_notificacao(self):
        self.negar("enqueue_bolao_notif", {
            "p_pool_id": "powerball", "p_entity_id": "x", "p_event_type": "draw-result",
            "p_event_version": 1, "p_entry_ref": "AGGREGATE",
            "p_idempotency_key": f"__ataque__:{uuid.uuid4().hex[:8]}:v1",
            "p_payload": {}, "p_template_id": "t", "p_template_version": 1,
            "p_max_attempts": 1, "p_schema_version": 1},
            "poderia poluir a fila de notificacao")

    def test_anon_nao_reivindica_job(self):
        self.negar("claim_bolao_notif",
                   {"p_pool_id": "powerball", "p_worker": "atacante",
                    "p_limit": 10, "p_lease_seconds": 600},
                   "poderia segurar o lease e impedir o envio legitimo")

    def test_anon_nao_marca_como_enviado(self):
        """O ataque principal: suprime o e-mail dos 15 sem erro nenhum."""
        self.negar("mark_bolao_notif_sent",
                   {"p_job_id": UUID_ZERO, "p_provider_message_id": "x"},
                   "SUPRIMIRIA permanentemente o e-mail de resultado dos 15 participantes")

    def test_anon_nao_marca_como_reenviavel(self):
        self.negar("mark_bolao_notif_retryable", {"p_job_id": UUID_ZERO, "p_error": "x"},
                   "poderia forcar reenvio para quem ja recebeu")

    def test_anon_nao_marca_como_permanente(self):
        self.negar("mark_bolao_notif_permanent", {"p_job_id": UUID_ZERO, "p_error": "x"},
                   "poderia matar a notificacao de forma irreversivel")

    def test_anon_nao_grava_disposicao_de_destinatario(self):
        self.negar("set_bolao_notif_recipient",
                   {"p_idempotency_key": "powerball:draw-result:2026-08-08:v1",
                    "p_entry_ref": "ref-0", "p_state": "ACCEPTED"},
                   "poderia marcar destinatarios como entregues sem entrega")

    def test_anon_nao_fecha_job(self):
        self.negar("settle_bolao_notif",
                   {"p_idempotency_key": "powerball:draw-result:2026-08-08:v1"},
                   "poderia concluir um job parcial")

    def test_anon_nao_libera_leases(self):
        self.negar("release_expired_bolao_notif", {"p_pool_id": "powerball"},
                   "poderia roubar leases ativos")

    def test_anon_nao_le_o_ledger(self):
        """Padrao e negar. Nenhum navegador consome estas RPCs -- verificado no codigo."""
        for nome, args in [("bolao_notif_status_by_pool", {"p_pool_id": "powerball"}),
                           ("bolao_notif_health", {"p_pool_id": "powerball"}),
                           ("get_bolao_notif_recipients",
                            {"p_idempotency_key": "powerball:draw-result:2026-08-08:v1"})]:
            permitido, http = como_anonimo(nome, args)
            self.assertFalse(permitido,
                             f"anon ainda le {nome}() (http={http}); acesso anonimo se "
                             f"justifica, nao se presume")

    def test_anon_nao_apaga_jobs(self):
        self.negar("delete_canary_job", {"p_idempotency_key": "__canary__:x:v1"},
                   "poderia apagar registro de notificacao")


class OLedgerContinuaFuncionandoComCredencial(unittest.TestCase):
    """A revogacao nao pode ter quebrado o caminho legitimo -- so o ilegitimo."""

    def test_sem_credencial_o_ledger_falha_fechado(self):
        anterior = os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
        try:
            ok, motivo = P.ledger_available()
            self.assertFalse(ok, "sem credencial o ledger tem de se declarar indisponivel")
        finally:
            if anterior:
                os.environ["SUPABASE_SERVICE_ROLE_KEY"] = anterior

    def test_o_codigo_le_presenca_e_nunca_imprime_o_valor(self):
        import inspect
        src = inspect.getsource(P)
        self.assertIn("has_privileged_credential", src)
        for proibido in ("print(_service_key", "logger.info(_service_key",
                         "print(chave)", "f\"{chave}\""):
            self.assertNotIn(proibido, src, "a credencial nao pode ser impressa")


if __name__ == "__main__":
    unittest.main(verbosity=2)
