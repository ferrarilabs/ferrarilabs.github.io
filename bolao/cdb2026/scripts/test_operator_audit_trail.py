#!/usr/bin/env python3
"""test_operator_audit_trail.py — a trilha de auditoria é VERIFICADA, nunca presumida (#413).

─── A ILUSÃO QUE ISTO REMOVE ───────────────────────────────────────────────────────────────────

Três comandos de operador do CDB2026 faziam:

    estado.setdefault("auditLog", []).append({...})

Parecia trilha de auditoria. Não era. Desde que `grava_estado()` saiu — o CLI passou a gravar por
mutação estreita via `cdb_apply_operator_mutation` em vez de PATCH do documento inteiro — o
dicionário devolvido por `le_estado()` **nunca volta ao servidor**. O append vivia na memória do
processo e morria com ele.

O dano não é perder auditoria: a trilha real existe, gravada pelo servidor a partir de
`p_actor`/`p_client_ref`. O dano é o código **parecer** ter uma segunda fonte quando há uma só — e
foi exatamente essa aparência que fez o `materialize-derived-phase` nascer com o mesmo padrão morto
copiado, até alguém descobrir que não funcionava.

─── O QUE ESTE GATE TRAVA ──────────────────────────────────────────────────────────────────────

1. o append morto não pode voltar, em comando nenhum;
2. cada comando que grava tem de RELER o estado e exigir a entrada de trilha correspondente;
3. se o servidor aplicou a escrita e não registrou a trilha, o comando **aborta** — dizer "feito"
   sem deixar rastro é pior que falhar.

Hermético: sem rede, sem Supabase.
"""
import ast
import io
import os
import re
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
FONTE = io.open(AQUI / "operator_cli.py", encoding="utf-8").read()

ok = fail = 0


def test(nome, fn):
    global ok, fail
    try:
        fn(); print(f"  ✓ {nome}"); ok += 1
    except AssertionError as e:
        print(f"  ✗ {nome}\n      {e}"); fail += 1


def A(c, m):
    if not c:
        raise AssertionError(m)


def corpo(nome):
    arvore = ast.parse(FONTE)
    for no in ast.walk(arvore):
        if isinstance(no, ast.FunctionDef) and no.name == nome:
            return ast.get_source_segment(FONTE, no)
    raise AssertionError(f"função {nome}() não encontrada")


COMANDOS_QUE_GRAVAM = ["cmd_apply_draw", "cmd_open_picks", "cmd_materialize_derived_phase"]

print("\nTrilha de auditoria de operador — verificada, não presumida\n")
print("A. O append morto não pode voltar")


def _sem_append_morto():
    # `auditLog` só pode ser LIDO (verificação), nunca acrescentado localmente.
    padrao = re.compile(r'setdefault\(\s*["\']auditLog["\']\s*,\s*\[\]\s*\)\s*\.append')
    achados = [c for c in COMANDOS_QUE_GRAVAM if padrao.search(corpo(c))]
    A(not achados,
      f"append local de auditLog voltou em: {achados} — ele nunca chega ao servidor e produz a "
      f"ILUSÃO de trilha")


test("nenhum comando acrescenta auditLog localmente", _sem_append_morto)


def _grava_estado_nao_voltou():
    # A premissa inteira depende disto: se o documento voltasse a ser gravado inteiro, o append
    # local funcionaria de novo — e a verificação abaixo passaria a ser redundante em vez de
    # necessária. Se alguém reintroduzir `grava_estado`, este gate tem de ser repensado, não
    # silenciosamente satisfeito.
    # Pela AST, não por texto. A primeira versão deste teste varria o fonte com `split("#")` e
    # reprovou em cima dos próprios COMENTÁRIOS que explicam por que `grava_estado` saiu — a prosa
    # cita o token que o teste bane. Um gate que não distingue código de comentário acaba
    # castigando a documentação da correção.
    arvore = ast.parse(FONTE)
    refs = [n for n in ast.walk(arvore)
            if (isinstance(n, ast.FunctionDef) and n.name == "grava_estado")
            or (isinstance(n, ast.Name) and n.id == "grava_estado")
            or (isinstance(n, ast.Attribute) and n.attr == "grava_estado")]
    A(not refs,
      "`grava_estado` voltou ao CLI (como código, não comentário) — a premissa deste gate mudou "
      "e ele precisa ser reavaliado")


test("`grava_estado` continua ausente (a premissa do gate)", _grava_estado_nao_voltou)

print("\nB. Cada comando que grava exige a trilha do servidor")

for cmd in COMANDOS_QUE_GRAVAM:
    def _exige(cmd=cmd):
        c = corpo(cmd)
        A('.get("auditLog")' in c, f"{cmd}: não relê `auditLog` do estado — a trilha fica presumida")
        A("clientRef" in c, f"{cmd}: não confere o clientRef que ele mesmo enviou")

        # Pela AST, e não por presença de texto. A primeira versão só exigia que as strings
        # existissem no corpo — e `if False:` ao redor delas mantinha o texto intacto e o teste
        # verde, com a guarda desligada. Aqui a guarda tem de ser um `if` VIVO cuja condição
        # menciona a trilha e cujo corpo alimenta `problemas`.
        fn = next(n for n in ast.walk(ast.parse(FONTE))
                  if isinstance(n, ast.FunctionDef) and n.name == cmd)
        viva = False
        for no in ast.walk(fn):
            if not isinstance(no, ast.If):
                continue
            cond = ast.dump(no.test)
            if isinstance(no.test, ast.Constant):      # `if False:` / `if True:` = guarda morta
                continue
            if "trilha" not in cond and "auditLog" not in cond:
                continue
            corpo_txt = " ".join(ast.dump(x) for x in no.body)
            if "problemas" in corpo_txt:
                viva = True
                break
        A(viva,
          f"{cmd}: não há guarda VIVA que condicione `problemas` à ausência de trilha — "
          f"o texto pode estar lá com a condição desligada")

    test(f"{cmd} relê o estado e exige a trilha", _exige)


def _aborta_de_verdade():
    # A verificação só vale se `problemas` realmente derrubar o comando. Um `problemas` que só
    # imprime é um gate decorativo.
    for cmd in COMANDOS_QUE_GRAVAM:
        c = corpo(cmd)
        A(re.search(r"if problemas:", c), f"{cmd}: não testa `problemas`")
        trecho = c[c.index("if problemas:"):]
        A("return 2" in trecho[:400],
          f"{cmd}: `problemas` não leva a saída de erro — a verificação não morde")


test("trilha ausente leva a exit 2, não a um aviso", _aborta_de_verdade)

print("\nC. O clientRef verificado é o MESMO que foi enviado")


def _mesmo_clientref():
    # Verificar um clientRef diferente do enviado passaria sempre — e não protegeria nada.
    c = corpo("cmd_materialize_derived_phase")
    A('f"materialize:{fase}:{tid}"' in c,
      "o clientRef enviado no create-tie mudou de forma; a verificação precisa acompanhar")
    A(c.count('f"materialize:{fase}:{tid}"') >= 2,
      "o clientRef é construído uma vez só — envio e verificação têm de usar a MESMA forma, "
      "senão a verificação confere um rótulo que ninguém gravou")

    c2 = corpo("cmd_open_picks")
    A(c2.count(f'open-picks:{{a.phase}}') >= 2,
      "cmd_open_picks: envio e verificação não compartilham a forma do clientRef")


test("envio e verificação usam a mesma forma de clientRef", _mesmo_clientref)

print(f"\n  {ok} passed, {fail} failed\n")
print("✗ OPERATOR AUDIT TRAIL FAILED" if fail else "✓ OPERATOR AUDIT TRAIL OK")
sys.exit(1 if fail else 0)
