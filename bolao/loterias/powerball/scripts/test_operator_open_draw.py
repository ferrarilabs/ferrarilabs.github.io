#!/usr/bin/env python3
"""
Testes da abertura de sorteio no banco (`operator_open_draw.py`).

Nenhum teste alcanca o banco: `planeja()` e puro e `aplica()` recebe um escritor INJETADO que
reproduz o banco em memoria. O que estes casos protegem: que um nome que nao resolve nao grave
NADA, e que reexecutar o mesmo manifesto nao crie sorteio, participacao nem cobranca em dobro.
"""

import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import operator_open_draw as od  # noqa: E402

POOL = "11111111-0000-0000-0000-000000000000"


def manifesto(**kw):
    m = {
        "draw_date": "2026-10-28", "jackpot": 716000000, "cash_value": 307200000,
        "contributions": [
            {"name": "Rodrigo Hajj", "amount": 10, "method": "Zelle", "paid_at": "2026-10-27T13:01:51-04:00"},
            {"name": "Simone Hirle da Costa", "amount": 10, "method": "Venmo",
             "paid_at": "2026-10-27T13:32:08-04:00"},
        ],
    }
    m.update(kw)
    return m


def banco():
    return {
        "draws": [{"draw_id": "d-0812", "pool_id": POOL, "draw_date": "2026-08-12"},
                  {"draw_id": "d-0810", "pool_id": POOL, "draw_date": "2026-08-10"}],
        "participants": [{"participant_id": "p-rod", "display_name": "Rodrigo Hajj"},
                         {"participant_id": "p-sim", "display_name": "Simone Hirle da Costa"},
                         {"participant_id": "p-mar", "display_name": "Marcelo Moreira"}],
        "participations": [{"participation_id": "pa-old", "participant_id": "p-rod", "draw_id": "d-0812"}],
    }


class FakeBanco:
    """Escritor duplo: guarda o que seria gravado e devolve o estado como o PostgREST devolveria."""

    def __init__(self, estado):
        self.estado = copy.deepcopy(estado)
        self.txns = []
        self.pg = self
        self.escritas = 0

    def le(self):
        return copy.deepcopy(self.estado)

    def cria_sorteio(self, plano):
        self.escritas += 1
        d = {"draw_id": f"d-{plano['draw_date']}", "pool_id": plano["pool_id"], "draw_date": plano["draw_date"]}
        self.estado["draws"].append(d)
        return d["draw_id"]

    def cria_participacao(self, participant_id, pool_id, draw_id):
        self.escritas += 1
        pa = {"participation_id": f"pa-{participant_id}-{draw_id}", "participant_id": participant_id,
              "draw_id": draw_id}
        self.estado["participations"].append(pa)
        return pa["participation_id"]

    def insert_transaction(self, req):
        ja = [t for t in self.txns if t["operator_client_ref"] == req["operator_client_ref"]]
        if ja:
            return {"applied": False, "already": True, "transaction_id": ja[0]["transaction_id"]}
        self.escritas += 1
        t = {**req, "transaction_id": f"t-{len(self.txns) + 1}"}
        self.txns.append(t)
        return {"applied": True, "transaction_id": t["transaction_id"]}


class Manifesto(unittest.TestCase):
    def test_valido(self):
        od.valida_manifesto(manifesto())

    def test_referencia_de_pagamento_e_recusada(self):
        m = manifesto()
        m["contributions"][0]["external_reference"] = "31376418395"
        with self.assertRaisesRegex(od.OperatorError, "repo publico"):
            od.valida_manifesto(m)

    def test_metodo_desconhecido(self):
        m = manifesto()
        m["contributions"][0]["method"] = "PIX"
        with self.assertRaisesRegex(od.OperatorError, "metodo desconhecido"):
            od.valida_manifesto(m)

    def test_nome_repetido(self):
        m = manifesto()
        m["contributions"][1]["name"] = "rodrigo  HAJJ"
        with self.assertRaisesRegex(od.OperatorError, "repetido"):
            od.valida_manifesto(m)

    def test_paid_at_sem_fuso(self):
        m = manifesto()
        m["contributions"][0]["paid_at"] = "2026-10-27T13:01:51"
        with self.assertRaisesRegex(od.OperatorError, "sem fuso"):
            od.valida_manifesto(m)

    def test_valor_negativo(self):
        m = manifesto()
        m["contributions"][0]["amount"] = -10
        with self.assertRaisesRegex(od.OperatorError, "positivo"):
            od.valida_manifesto(m)


class Plano(unittest.TestCase):
    def test_nome_sem_participante_nao_grava_nada(self):
        m = manifesto()
        m["contributions"].append({"name": "Fulano Novo", "amount": 10, "method": "Zelle",
                                   "paid_at": "2026-10-27T15:00:00-04:00"})
        fake = FakeBanco(banco())
        with self.assertRaisesRegex(od.OperatorError, "ZERO escritas"):
            od.planeja(od.valida_manifesto(m), fake.le(), "op")
        self.assertEqual(fake.escritas, 0)

    def test_sobrenome_sozinho_nao_resolve(self):
        # O Zelle da linha 2 veio so como "MOREIRA". Igualdade normalizada, nunca parcial.
        m = manifesto(contributions=[{"name": "MOREIRA", "amount": 10, "method": "Zelle",
                                      "paid_at": "2026-10-27T13:20:47-04:00"}])
        with self.assertRaisesRegex(od.OperatorError, "0 participante"):
            od.planeja(od.valida_manifesto(m), banco(), "op")

    def test_caixa_e_acento_nao_importam(self):
        b = banco()
        b["participants"][1]["display_name"] = "Simóne HIRLE da Costa"
        plano = od.planeja(od.valida_manifesto(manifesto()), b, "op")
        self.assertEqual([i["participant_id"] for i in plano["itens"]], ["p-rod", "p-sim"])

    def test_nome_ambiguo_recusado(self):
        b = banco()
        b["participants"].append({"participant_id": "p-rod2", "display_name": "rodrigo hajj"})
        with self.assertRaisesRegex(od.OperatorError, "2 participante"):
            od.planeja(od.valida_manifesto(manifesto()), b, "op")

    def test_dois_pools_recusado(self):
        b = banco()
        b["draws"][1]["pool_id"] = "outro"
        with self.assertRaisesRegex(od.OperatorError, "pools distintos"):
            od.planeja(od.valida_manifesto(manifesto()), b, "op")

    def test_sorteio_no_passado_recusado(self):
        with self.assertRaisesRegex(od.OperatorError, "passado"):
            od.planeja(od.valida_manifesto(manifesto(draw_date="2026-08-11")), banco(), "op")

    def test_participacao_de_outro_sorteio_nao_e_reusada(self):
        plano = od.planeja(od.valida_manifesto(manifesto()), banco(), "op")
        self.assertIsNone(plano["draw"])
        self.assertTrue(all(i["participation_id"] is None for i in plano["itens"]))


class Aplicacao(unittest.TestCase):
    def test_aplica_e_reexecucao_e_noop(self):
        fake = FakeBanco(banco())
        m = od.valida_manifesto(manifesto())
        r1 = od.aplica(od.planeja(m, fake.le(), "op"), fake)
        self.assertTrue(all(r["applied"] for r in r1))
        self.assertEqual(len([d for d in fake.estado["draws"] if d["draw_date"] == "2026-10-28"]), 1)
        self.assertEqual(len(fake.txns), 2)
        self.assertEqual({t["paid_at"] for t in fake.txns},
                         {"2026-10-27T13:01:51-04:00", "2026-10-27T13:32:08-04:00"})
        self.assertTrue(all(t["txn_type"] == "contribution" for t in fake.txns))
        self.assertTrue(all(not t.get("external_reference") for t in fake.txns))

        escritas = fake.escritas
        r2 = od.aplica(od.planeja(m, fake.le(), "op"), fake)
        self.assertTrue(all(r.get("already") for r in r2))
        self.assertEqual(fake.escritas, escritas, "reexecucao gravou alguma coisa")
        self.assertEqual(len(fake.estado["draws"]), 3)
        self.assertEqual(len(fake.estado["participations"]), 3)

    def test_participacao_duplicada_no_sorteio_recusada(self):
        b = banco()
        b["draws"].append({"draw_id": "d-1028", "pool_id": POOL, "draw_date": "2026-10-28"})
        b["participations"] += [{"participation_id": f"pa-{i}", "participant_id": "p-rod", "draw_id": "d-1028"}
                                for i in range(2)]
        with self.assertRaisesRegex(od.OperatorError, "2 participacoes"):
            od.planeja(od.valida_manifesto(manifesto()), b, "op")


class ManifestoVersionado(unittest.TestCase):
    """Os manifestos commitados tem de passar na mesma validacao que o runner aplica."""

    def test_manifestos_do_repo_sao_validos(self):
        import json
        pasta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "operations")
        arquivos = [f for f in os.listdir(pasta) if f.endswith(".json")]
        self.assertTrue(arquivos)
        for f in arquivos:
            with open(os.path.join(pasta, f), encoding="utf-8") as fh:
                od.valida_manifesto(json.load(fh))


if __name__ == "__main__":
    unittest.main(verbosity=1)
