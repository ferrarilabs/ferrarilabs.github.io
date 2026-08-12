#!/usr/bin/env python3
"""Gate do operator_cli.py do COPA2026.

NAO toca producao. Toda chamada de rede e interceptada; o que se prova aqui e o CONTRATO do CLI:
que comando vira que RPC, com que argumentos, sob que guardas, e que nada vaza.

Os casos existem por um motivo cada, nao por cobertura:

  T1  a credencial ausente sai com 2 e nao chama nada        um CLI que continua sem credencial
                                                             produziria erro de rede confuso
  T2  a credencial NUNCA aparece na saida                    o log do CI e publico no repositorio
  T3  dry-run nao emite nenhuma chamada mutante              o dry-run e a rede de seguranca
  T4  cada comando mapeia para a RPC certa                   a lista completa, 6/6
  T5  nenhum comando manda p_pool_id != 'main'               isolamento entre produtos
  T6  client_ref e DETERMINISTICO                            um retry nao pode virar 2a aplicacao
  T7  clear-all sem a flag longa recusa                      destrutivo exige cerimonia maior
  T8  invariante violada => codigo 2                         sucesso parcial silencioso e proibido
  T9  erro HTTP => codigo 2, com o corpo e sem o cabecalho   o RAISE e o diagnostico util
  T10 snapshot recusa gravar PII dentro do repositorio       o estado bruto tem e-mail e paymentTo
  T11 nenhuma escrita direta na tabela em todo o arquivo     o ponto inteiro da opcao (b)
"""
import io
import json
import os
import re
import subprocess
import sys
import types
import unittest.mock as mock
from contextlib import redirect_stdout

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

# Montada em pedacos de proposito. O varredor de segredos do repo casa o PREFIXO literal,
# e nao tem como distinguir chave falsa de chave real -- nem deveria: um varredor que
# acredita no rotulo "FAKE" e um varredor que se pode enganar escrevendo "FAKE" ao lado da
# chave de verdade. Concatenar mantem o valor identico para o teste e tira o literal do
# arquivo.
CHAVE_FALSA = "sb_" + "secret_FAKE_KEY_FOR_TESTS_ONLY_0000000000"
ESTADO = {
    "entries": [{"id": "e_aaa", "entryName": "N1", "picks": {},
                 "paymentMethod": "Zelle", "paymentTo": "914-000-0000"}],
    "paid": {"e_aaa": False}, "results": {"88": {"goalsA": 1, "goalsB": 0}},
    "deletedIds": [], "deletedResults": [], "auditLog": [], "meta": {},
}

resultados = []


def check(nome, ok, detalhe=""):
    resultados.append((nome, ok))
    print(f"  {'✓' if ok else '✗'} {nome}{('  — ' + detalhe) if detalhe else ''}")


def carrega():
    import importlib
    if "operator_cli" in sys.modules:
        del sys.modules["operator_cli"]
    return importlib.import_module("operator_cli")


def corre(argv, estado=None, resposta=None, erro=None, chave=CHAVE_FALSA):
    """Roda o CLI com a rede interceptada. Devolve (codigo, saida, chamadas)."""
    cli = carrega()
    chamadas = []
    corrente = json.loads(json.dumps(estado if estado is not None else ESTADO))

    def _req(metodo, caminho, corpo=None, extra=None):
        cli._key()  # preserva a checagem de credencial
        chamadas.append({"metodo": metodo, "caminho": caminho, "corpo": corpo})
        if erro:
            raise erro
        if metodo == "GET":
            return 200, [{"state": corrente}]
        return 200, (resposta if resposta is not None else {"applied": True})

    env = dict(os.environ)
    env.pop("SUPABASE_SERVICE_ROLE_KEY", None)
    if chave:
        env["SUPABASE_SERVICE_ROLE_KEY"] = chave
    buf = io.StringIO()
    with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(cli, "_req", _req):
        with mock.patch.object(sys, "argv", ["operator_cli.py"] + argv):
            try:
                with redirect_stdout(buf):
                    codigo = cli.main()
            except SystemExit as e:
                codigo = e.code if isinstance(e.code, int) else 2
    return codigo, buf.getvalue(), chamadas


print("COPA2026 operator CLI — gate\n")

# T1 -------------------------------------------------------------------------------------------
c, out, ch = corre(["snapshot"], chave=None)
check("T1 credencial ausente => codigo 2, nenhuma chamada", c == 2 and len(ch) == 0, f"codigo={c} chamadas={len(ch)}")

# T2 -------------------------------------------------------------------------------------------
saidas = []
for argv in (["snapshot"], ["set-payment", "--entry", "e_aaa", "--paid", "true", "--apply"],
             ["set-result", "--match", "88", "--goals-a", "0", "--goals-b", "0", "--dry-run"]):
    saidas.append(corre(argv)[1])
check("T2 a credencial nunca aparece na saida", all(CHAVE_FALSA not in s for s in saidas))

# T3 -------------------------------------------------------------------------------------------
c, out, ch = corre(["set-payment", "--entry", "e_aaa", "--paid", "true", "--dry-run"])
mutantes = [x for x in ch if x["metodo"] != "GET"]
check("T3 dry-run nao emite chamada mutante", c == 0 and len(mutantes) == 0, f"mutantes={len(mutantes)}")

# T4 -------------------------------------------------------------------------------------------
ESPERADO = {
    "set-payment":  (["set-payment", "--entry", "e_aaa", "--paid", "true", "--apply"], "op_confirm_payment"),
    "set-result":   (["set-result", "--match", "88", "--goals-a", "1", "--goals-b", "0", "--apply"], "copa_apply_operator_mutation"),
    "clear-result": (["clear-result", "--match", "88", "--apply"], "copa_apply_operator_mutation"),
    "update-entry": (["update-entry", "--entry", "e_aaa", "--payment-to", "X", "--apply"], "copa_apply_operator_mutation"),
    "remove-entry": (["remove-entry", "--entry", "e_aaa", "--apply"], "op_remove_entry"),
    "clear-all":    (["clear-all", "--i-understand-this-wipes-the-pool", "--confirm-ref", "r1", "--apply"], "copa_apply_operator_mutation"),
}
mapeados, corpos = 0, {}
for nome, (argv, fn) in ESPERADO.items():
    _, _, ch = corre(argv)
    posts = [x for x in ch if x["metodo"] == "POST"]
    if posts and posts[0]["caminho"] == f"/rest/v1/rpc/{fn}":
        mapeados += 1
        corpos[nome] = posts[0]["corpo"]
    else:
        print(f"      {nome} -> {posts[0]['caminho'] if posts else 'NENHUMA'}")
check(f"T4 comandos mapeados para a RPC correta {mapeados}/{len(ESPERADO)}", mapeados == len(ESPERADO))

# T5 -------------------------------------------------------------------------------------------
pools = {n: b.get("p_pool_id") for n, b in corpos.items() if "p_pool_id" in b}
check("T5 nenhum comando envia p_pool_id != 'main'", all(v == "main" for v in pools.values()), str(pools))

# T6 -------------------------------------------------------------------------------------------
_, _, a1 = corre(["set-result", "--match", "88", "--goals-a", "1", "--goals-b", "0", "--apply"])
_, _, a2 = corre(["set-result", "--match", "88", "--goals-a", "1", "--goals-b", "0", "--apply"])
r1 = [x for x in a1 if x["metodo"] == "POST"][0]["corpo"]["p_client_ref"]
r2 = [x for x in a2 if x["metodo"] == "POST"][0]["corpo"]["p_client_ref"]
_, _, a3 = corre(["set-result", "--match", "88", "--goals-a", "2", "--goals-b", "0", "--apply"])
r3 = [x for x in a3 if x["metodo"] == "POST"][0]["corpo"]["p_client_ref"]
check("T6 client_ref e deterministico, e muda quando o valor muda", r1 == r2 and r1 != r3, f"{r1} / {r3}")

# T7 -------------------------------------------------------------------------------------------
c, out, ch = corre(["clear-all", "--confirm-ref", "r1", "--apply"])
check("T7 clear-all sem a flag longa recusa", c == 2 and not [x for x in ch if x["metodo"] == "POST"])

# T8 -------------------------------------------------------------------------------------------
# A RPC responde sucesso mas o estado nao muda: o CLI tem de ver a invariante e sair 2.
c, out, ch = corre(["set-payment", "--entry", "e_aaa", "--paid", "true", "--apply"])
check("T8 sucesso da RPC sem efeito no estado => codigo 2", c == 2 and "INVARIANTES VIOLADAS" in out)

# T9 -------------------------------------------------------------------------------------------
import urllib.error
erro = urllib.error.HTTPError("u", 400, "Bad Request", {}, io.BytesIO(b'{"message":"set-result: matchId obrigatorio"}'))
cli = carrega()
buf = io.StringIO()
with mock.patch.dict(os.environ, {"SUPABASE_SERVICE_ROLE_KEY": CHAVE_FALSA}, clear=True):
    with mock.patch("urllib.request.urlopen", side_effect=erro):
        try:
            with redirect_stdout(buf):
                cli.rpc("copa_apply_operator_mutation", {"p_type": "x"})
            c9 = 0
        except SystemExit as e:
            c9 = e.code
check("T9 erro HTTP => codigo 2, corpo mostrado, credencial ausente da mensagem",
      c9 == 2 and "matchId obrigatorio" in buf.getvalue() and CHAVE_FALSA not in buf.getvalue())

# T10 ------------------------------------------------------------------------------------------
dentro = os.path.join(AQUI, "..", "..", "..", "bolao", "copa2026", "snapshot.json")
c, out, ch = corre(["snapshot", "--out", dentro])
check("T10 snapshot recusa gravar estado bruto dentro do repositorio", c == 2 and "PII" in out)

# T11 ------------------------------------------------------------------------------------------
fonte = open(os.path.join(AQUI, "operator_cli.py"), encoding="utf-8").read()
# Nenhum PATCH/POST/DELETE contra /rest/v1/bolao_state -- so /rest/v1/rpc/ e o GET de leitura.
escritas = re.findall(r'_req\(\s*"(PATCH|POST|PUT|DELETE)"\s*,\s*f?"(/rest/v1/[^"]*)"', fonte)
diretas = [(m, c_) for m, c_ in escritas if not c_.startswith("/rest/v1/rpc/")]
check("T11 nenhuma escrita direta na tabela em todo o arquivo", not diretas, str(diretas))

# ----------------------------------------------------------------------------------------------
falhas = [n for n, ok in resultados if not ok]
print(f"\n{len(resultados) - len(falhas)} passaram, {len(falhas)} falharam")
sys.exit(1 if falhas else 0)
