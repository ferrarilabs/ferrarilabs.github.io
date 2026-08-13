#!/usr/bin/env python3
"""POWERBALL — o atualizador de metadados nao pode sobrescrever dado de participante.

POR QUE ESTE GATE EXISTE
------------------------
`refresh_jackpot.py` roda de 6 em 6 horas e escreve no MESMO `data.js` onde vivem participantes,
pagamentos e bilhetes -- que outra pessoa esta editando ao mesmo tempo. Em 2026-08-11 uma sessao
paralela adicionou nove participantes reais e US$ 90 em pagamentos confirmados enquanto o
atualizador estava armado.

O modo de falha e classico e silencioso: ler o documento inteiro, mudar um campo, gravar o
documento inteiro. Quem gravar por ultimo apaga o trabalho do outro -- e ninguem percebe, porque
nada falha; simplesmente somem pessoas que ja pagaram.

A defesa aqui e estrutural, nao um aviso: o atualizador edita o bloco `drawing` por ANCORA DE
TEXTO, e confere depois de gravar que participantes, bilhetes e resultado nao mudaram.

Executar: python3 bolao/loterias/powerball/scripts/test_metadata_concurrency.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA_JS = os.path.join(AQUI, "..", "js", "data.js")


def le_draws(caminho):
    leitor = (
        "const fs=require('fs'),vm=require('vm');const sb={window:{}};vm.createContext(sb);"
        "vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),sb);"
        "process.stdout.write(JSON.stringify(sb.window.POWERBALL_DRAWS||[]));"
    )
    out = subprocess.run(["node", "-e", leitor, caminho], capture_output=True, text=True, timeout=20)
    if out.returncode != 0:
        raise RuntimeError(out.stderr[:300])
    return json.loads(out.stdout)


class AtualizadorDeMetadadosEIsolado(unittest.TestCase):
    """Simula a corrida real: A lê, B acrescenta participante, A grava metadados."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.copia = os.path.join(self.tmp, "data.js")
        shutil.copy(DATA_JS, self.copia)

        # A PRECONDIÇÃO É CONSTRUÍDA, NÃO TORCIDA.
        #
        # Estes testes precisam de um sorteio ABERTO (sem resultado) porque é nele que o
        # atualizador de metadados escreve. A versão anterior simplesmente ESPERAVA que o
        # `data.js` de produção tivesse um — e em 2026-08-13, quando o resultado do sorteio de
        # 12/08 foi gravado, não havia mais nenhum: a suíte ficou vermelha sem que nada tivesse
        # regredido. Um teste cuja precondição depende do estado do dia mede o calendário.
        #
        # A CÓPIA (nunca o arquivo real) tem o resultado do último sorteio removido, o que
        # reproduz exatamente a janela que interessa: o sorteio existe, tem participantes, e
        # ainda não saiu resultado. A estrutura textual do arquivo — que é o que as âncoras do
        # atualizador percorrem — continua sendo a de produção.
        if self._sorteio_aberto(le_draws(self.copia)) is None:
            texto = open(self.copia, encoding="utf-8").read()
            marca = texto.rindex("    result: {")
            fim = texto.index("\n    },\n", marca) + len("\n    },\n")
            texto = texto[:marca] + "    result: null,\n" + texto[fim:]
            open(self.copia, "w", encoding="utf-8").write(texto)
            self.assertIsNotNone(
                self._sorteio_aberto(le_draws(self.copia)),
                "nao foi possivel construir a precondicao: o formato do data.js mudou")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _sorteio_aberto(self, draws):
        abertos = [d for d in draws if not (d.get("result") or {}).get("numbers")]
        return abertos[-1] if abertos else None

    def test_edicao_de_jackpot_nao_toca_participantes(self):
        """A ancora textual do `drawing` não pode alcançar o array de participantes."""
        antes = le_draws(self.copia)
        alvo = self._sorteio_aberto(antes)
        self.assertIsNotNone(alvo, "o data.js nao tem sorteio aberto — fixture invalida")

        fonte = open(self.copia, encoding="utf-8").read()
        # Exatamente a substituicao que o refresh_jackpot.py faz.
        novo = re.sub(r"(\n      jackpot: )[^,\n]+(,)", r"\g<1>123456789\g<2>", fonte, count=1)
        self.assertNotEqual(novo, fonte, "a ancora de jackpot nao casou")
        open(self.copia, "w", encoding="utf-8").write(novo)

        depois = le_draws(self.copia)
        for a, d in zip(antes, depois):
            self.assertEqual(a.get("participants"), d.get("participants"),
                             f"participantes de {a['id']} mudaram numa edicao de jackpot")
            self.assertEqual(a.get("sharedTickets"), d.get("sharedTickets"),
                             f"bilhetes de {a['id']} mudaram numa edicao de jackpot")
            self.assertEqual(a.get("finance"), d.get("finance"),
                             f"financeiro de {a['id']} mudou numa edicao de jackpot")
            self.assertEqual(a.get("result"), d.get("result"),
                             f"resultado de {a['id']} mudou numa edicao de jackpot")

    def test_participante_adicionado_por_outra_sessao_sobrevive(self):
        """A CORRIDA. A lê o arquivo; B acrescenta alguém; A grava o jackpot. B tem de continuar lá."""
        antes = le_draws(self.copia)
        alvo = self._sorteio_aberto(antes)
        n_antes = len(alvo.get("participants") or [])

        # ── sessão B: acrescenta um participante ao sorteio aberto ────────────────────────────
        fonte = open(self.copia, encoding="utf-8").read()
        m = re.search(r'(\n    id: "' + re.escape(alvo["id"]) + r'".*?\n    participants: \[\n)',
                      fonte, re.S)
        self.assertIsNotNone(m, "nao encontrei o array de participantes do sorteio aberto")
        novo_part = ('      { name: "Participante Da Outra Sessao", cotas: 1, valor: 10, '
                     'metodo: "Zelle", data: "11/08/2026", hora: "1:00 PM", '
                     'status: "verificado", state: "NC" },\n')
        fonte_b = fonte[:m.end()] + novo_part + fonte[m.end():]
        open(self.copia, "w", encoding="utf-8").write(fonte_b)

        depois_b = le_draws(self.copia)
        self.assertEqual(len(self._sorteio_aberto(depois_b)["participants"]), n_antes + 1,
                         "a fixture da sessao B nao acrescentou ninguem")

        # ── sessão A: grava o jackpot, releitura do arquivo ATUAL (é o que o script faz) ──────
        atual = open(self.copia, encoding="utf-8").read()
        gravado = re.sub(r"(\n      jackpot: )[^,\n]+(,)", r"\g<1>987654321\g<2>", atual, count=1)
        open(self.copia, "w", encoding="utf-8").write(gravado)

        final = le_draws(self.copia)
        alvo_final = self._sorteio_aberto(final)
        nomes = [p["name"] for p in alvo_final["participants"]]
        self.assertIn("Participante Da Outra Sessao", nomes,
                      "o participante adicionado pela outra sessao SUMIU na gravacao do jackpot")
        self.assertEqual(len(nomes), n_antes + 1, "o numero de participantes regrediu")

    def test_o_script_verifica_invariantes_depois_de_gravar(self):
        """CONTRATO: não basta a âncora ser estreita; o script tem de CONFERIR depois."""
        src = open(os.path.join(AQUI, "refresh_jackpot.py"), encoding="utf-8").read()
        codigo = "\n".join(l for l in src.split("\n") if not l.strip().startswith("#"))
        self.assertIn("mexeu nos participantes", codigo,
                      "o refresh_jackpot deixou de conferir os participantes depois de gravar")
        self.assertIn("mexeu nos bilhetes", codigo,
                      "o refresh_jackpot deixou de conferir os bilhetes depois de gravar")
        self.assertRegex(codigo, r"open\(DATA_JS, \"w\", encoding=\"utf-8\"\)\.write\(fonte_txt\)",
                         "o refresh_jackpot deixou de REVERTER quando a invariante quebra")

    def test_o_script_relê_o_arquivo_antes_de_gravar(self):
        """Gravar a partir de um snapshot antigo é o que apaga o trabalho do outro."""
        src = open(os.path.join(AQUI, "refresh_jackpot.py"), encoding="utf-8").read()
        # A leitura do texto tem de acontecer DEPOIS da consulta a fonte oficial (que demora), e
        # imediatamente antes da edicao -- nao no comeco do processo.
        i_fonte = src.index("draw_id, jackpot, cash, erro = busca_proximo_sorteio()")
        i_leitura = src.index('fonte_txt = open(DATA_JS, encoding="utf-8").read()')
        self.assertLess(i_fonte, i_leitura,
                        "o data.js e lido ANTES da consulta a fonte — a janela de corrida aumenta "
                        "pelo tempo inteiro da requisicao de rede")


if __name__ == "__main__":
    unittest.main(verbosity=2)
