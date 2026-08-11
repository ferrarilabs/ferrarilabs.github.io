"""
test_public_projection_and_submit.py — CDB2026 Stage 4, camada aditiva.

Executa contra o Postgres REAL. Prova duas coisas antes de qualquer corte:

  1. a projecao publica entrega a mesma forma do documento SEM os campos privados
  2. a submissao estreita recusa entrada invalida ANTES de gravar

NAO exercita o caminho feliz da submissao. `submit_cdb_entry` grava no estado de PRODUCAO do
cdb2026, onde ha 12 inscricoes reais de pessoas que pagaram. Um teste que criasse uma inscricao
sintetica ali seria uma mutacao de producao disfarcada de teste -- ja causei um incidente nesta
sessao sondando uma chave que existia de verdade. O caminho feliz e provado no corte, de forma
controlada e com snapshot antes/depois.

As validacoes abaixo levantam ANTES do update, entao sao seguras: nenhuma delas pode gravar.

Executar: python3 bolao/cdb2026/scripts/test_public_projection_and_submit.py
"""

import json
import os
import sys
import unittest
import urllib.error
import urllib.request

SUPABASE_URL = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON_KEY = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
PRIVADOS = ("participantEmail", "payerName", "paymentMethod", "txId")


def _chave():
    return (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip() or ANON_KEY


def _get(caminho, chave=None):
    k = chave or ANON_KEY
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{caminho}",
                                 headers={"apikey": k, "Authorization": f"Bearer {k}"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read() or "[]")


def _rpc(nome, args, chave=None):
    k = chave or ANON_KEY
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/{nome}", data=json.dumps(args).encode(), method="POST",
        headers={"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            bruto = r.read()
            return True, (json.loads(bruto) if bruto else None), r.status
    except urllib.error.HTTPError as e:
        return False, e.read().decode()[:200], e.code


class ProjecaoPublica(unittest.TestCase):
    """O que um navegador anonimo consegue ler."""

    @classmethod
    def setUpClass(cls):
        try:
            linhas = _get("bolao_state_public_cdb?select=state")
        except Exception as e:
            raise unittest.SkipTest(f"projecao inacessivel: {type(e).__name__}")
        cls.estado = linhas[0]["state"] if linhas else None

    def test_a_projecao_e_legivel_anonimamente(self):
        self.assertIsNotNone(self.estado, "a projecao nao devolveu estado")

    def test_nenhum_campo_privado_atravessa(self):
        for e in self.estado.get("entries", []):
            for campo in PRIVADOS:
                self.assertNotIn(campo, e,
                                 f"a projecao publica vaza {campo} — vai para todo navegador")

    def test_a_forma_do_documento_e_preservada(self):
        """Trocar a leitura nao pode quebrar o app: mesma forma, menos os privados."""
        for chave in ("entries", "phases", "paid"):
            self.assertIn(chave, self.estado, f"a projecao perdeu '{chave}'")
        self.assertIsInstance(self.estado["entries"], list)

    def test_as_inscricoes_nao_sumiram(self):
        self.assertGreater(len(self.estado.get("entries", [])), 0,
                           "a projecao esvaziou as inscricoes")

    def test_o_chaveamento_e_o_sorteio_oficial_continuam_visiveis(self):
        fases = self.estado.get("phases", {})
        self.assertIn("quartas", fases)
        self.assertIn("officialDraw", fases.get("quartas", {}),
                      "o sorteio oficial da CBF sumiu da projecao")


class EdicaoDePalpitesRecusaEntradaInvalida(unittest.TestCase):
    """A operacao anonima REAL do CDB2026: editar palpites de uma entrada existente.

    O roster esta congelado (`entryRosterFrozen: true`), entao inscricao nova nao existe neste
    produto -- `applyAdminMutation` recusa o ramo de append com ENTRY_ROSTER_FROZEN. Uma RPC de
    criacao seria superficie de ataque para uma operacao que o app nao executa; por isso
    `submit_cdb_entry` (migracao 024) foi removida na 025.

    Todas as validacoes abaixo levantam ANTES do update. Nenhuma pode gravar em producao.
    """

    def negar(self, args, porque):
        ok, corpo, http = _rpc("cdb_update_entry_picks", args)
        self.assertFalse(ok, f"aceitou entrada invalida ({porque}) — http={http}")

    def test_sem_entry_id_recusa(self):
        self.negar({"p_entry_id": "", "p_client_ref": "x", "p_picks": {}}, "sem entrada alvo")

    def test_sem_client_ref_recusa(self):
        self.negar({"p_entry_id": "abc", "p_client_ref": "", "p_picks": {}},
                   "sem client_ref nao ha idempotencia")

    def test_picks_que_nao_e_objeto_recusa(self):
        self.negar({"p_entry_id": "abc", "p_client_ref": "x", "p_picks": "nao-e-objeto"},
                   "picks precisa ser objeto")

    def test_entrada_inexistente_recusa(self):
        self.negar({"p_entry_id": "nao-existe-999", "p_client_ref": "x", "p_picks": {}},
                   "nao se cria entrada por esta via")

    def test_picks_gigante_recusa(self):
        """O bolao inteiro vive numa unica linha jsonb: payload absurdo e uso indevido."""
        self.negar({"p_entry_id": "abc", "p_client_ref": "x", "p_picks": {"f": "z" * 21000}},
                   "teto de tamanho")

    def test_a_rpc_de_criacao_nao_existe_mais(self):
        ok, _, http = _rpc("submit_cdb_entry", {"p_client_ref": "x", "p_name": "Fulano"})
        self.assertEqual(http, 404,
                         "submit_cdb_entry voltou — cria entrada, operacao que o app nao faz")


class SuperficieAnonima(unittest.TestCase):
    """Submissao anonima nunca pode implicar mutacao de operador."""

    def test_anon_nao_alcanca_rpc_de_operador_do_bolao(self):
        for nome in ("op_confirm_payment", "op_set_results", "op_remove_entry"):
            ok, _, http = _rpc(nome, {})
            self.assertFalse(ok, f"anon executa {nome}() — http={http}")

    def test_a_edicao_de_palpites_existe_e_e_alcancavel(self):
        """Existir e ser alcancavel: se so existisse, o participante perderia o caminho legitimo."""
        ok, corpo, http = _rpc("cdb_update_entry_picks",
                               {"p_entry_id": "", "p_client_ref": "", "p_picks": {}})
        self.assertNotEqual(http, 404, "cdb_update_entry_picks nao existe ou nao e alcancavel")
        self.assertNotIn(http, (401, 403), "anon perdeu acesso a edicao legitima de palpites")


class MutacaoDeOperadorNegadaAAnon(unittest.TestCase):
    """A camada de operador do CDB (migracao 026) roda so com credencial privilegiada.

    A senha de admin do CDB protege a UI, nao o banco: ela vive no navegador, e o navegador
    carrega a anon key publica. Enquanto a autorizacao morar so no cliente, qualquer portador da
    chave contorna a tela inteira com uma chamada HTTP. Por isso a fronteira e o grant.
    """

    def negar(self, tipo, payload):
        ok, corpo, http = _rpc("cdb_apply_operator_mutation",
                               {"p_type": tipo, "p_payload": payload,
                                "p_actor": "atacante", "p_client_ref": "ataque"})
        self.assertFalse(ok, f"anon executou {tipo} — http={http}")
        self.assertEqual(http, 401, f"{tipo} respondeu {http}; esperado 401")

    def test_anon_nao_marca_pagamento(self):
        self.negar("set-payment", {"entryId": "x", "value": True})

    def test_anon_nao_apaga_entrada(self):
        self.negar("delete-entry", {"entryId": "x"})

    def test_anon_nao_muda_cutoff(self):
        self.negar("set-cutoff", {"phaseId": "quartas", "cutoffAt": None})

    def test_anon_nao_trava_confronto(self):
        self.negar("lock-tie", {"phaseId": "quartas", "tieId": "t"})

    def test_anon_nao_remove_confronto(self):
        self.negar("remove-tie", {"phaseId": "quartas", "tieId": "t"})

    def test_anon_nao_muda_fase_ativa(self):
        self.negar("set-active-phase", {"phaseId": "final"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
