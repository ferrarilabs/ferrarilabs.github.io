#!/usr/bin/env python3
"""Nenhum verificador pode alcancar o provedor de e-mail. Nunca.

O QUE ACONTECEU EM 2026-08-12
-----------------------------
O operador recebeu QUATRO e-mails do CDB em 45 minutos. Os dois ultimos nao vieram do defeito
que estava sendo consertado -- vieram dos VERIFICADORES.

`token_roundtrip_canary.py` e `secure_access_canary.py` emitiam, usavam e REVOGAVAM a credencial
de uma entrada REAL, escolhida por indice. Depois que os convites sairam, cada execucao matava o
link de quem calhasse de ser o primeiro da lista -- e calhou de ser o operador. Cada morte virou
outro e-mail de correcao.

O operador e participante, nao caixa de teste.

O QUE ESTE GATE TRAVA
---------------------
Duas invariantes, ambas estaticas (le fonte; sem rede, sem credencial):

  1. TODO caminho que fala com o provedor esta na lista de REMETENTES autorizados. Um arquivo
     novo que chame api.emailjs.com sem estar registrado reprova -- e registrar exige escrever
     por que ele existe.

  2. NENHUM arquivo de verificacao (test_/audit_/*canary*/probe/check_) alcanca o provedor,
     direta ou indiretamente, sem passar por um portao que recuse por padrao.

A segunda e a que faltava hoje. A primeira impede que a segunda seja contornada criando um
caminho novo.

Uso: python3 bolao/scripts/test_no_real_email_in_verification.py
"""
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
ok, fail = 0, 0


def test(nome, fn):
    global ok, fail
    try:
        fn()
        print(f"  ✓ {nome}")
        ok += 1
    except AssertionError as e:
        print(f"  ✗ {nome}\n      {e}")
        fail += 1
    except Exception as e:
        print(f"  ✗ {nome}\n      {type(e).__name__}: {e}")
        fail += 1


def _assert(c, m):
    if not c:
        raise AssertionError(m)


def versionados():
    out = subprocess.run(["git", "ls-files"], cwd=RAIZ, capture_output=True, text=True).stdout
    return [l for l in out.split("\n") if l.endswith((".py", ".mjs", ".js"))]


PROVEDOR = re.compile(r"api\.emailjs\.com|smtplib|sendgrid|mailgun|ses\.send_email")

# Remetentes AUTORIZADOS: cada um existe porque um evento de negocio real precisa dele.
# Acrescentar a esta lista deve doer um pouco -- e o momento de perguntar se o caminho novo
# realmente precisa falar com o provedor.
REMETENTES = {
    "bolao/loterias/powerball/scripts/send_result_email.py":  "resultado do sorteio",
    "bolao/loterias/powerball/scripts/email/send.mjs":        "transporte do powerball",
    "bolao/br2026/scripts/send_round_email.py":               "resultado de rodada",
    "bolao/copa2026/scripts/send_result_email.py":            "resultado (Copa, arquivada)",
    "bolao/copa2026/scripts/send_bracket_correction_email.py": "correcao de chaveamento (Copa)",
    "bolao/cdb2026/scripts/send_invitation_email.py":         "convite das quartas",
    "bolao/cdb2026/scripts/send_result_email.py":             "resultado do CDB",
    # Gate que INSPECIONA o fail-closed dos senders; cita o provedor em assercao, nao o chama.
    "bolao/scripts/test_python_sender_failclosed.py":         "gate sobre os senders",
}

E_VERIFICADOR = re.compile(r"(^|/)(test_|audit_|check_)|canary|probe|_test\.")

print("\nNenhum verificador alcanca o provedor\n")



# Remove comentarios E DOCSTRINGS antes de procurar padrao.
#
# Docstring nao e comentario: o filtro de linha pega "#", nao pega bloco com aspas triplas.
# QUATRO gates meus reprovaram hoje lendo a propria prosa -- inclusive este arquivo, cuja
# docstring cita o padrao proibido justamente para explicar o defeito.
#
# Gate que le prosa mede prosa.
def _sem_docstrings(txt):
    import ast as _ast
    try:
        arvore = _ast.parse(txt)
    except SyntaxError:
        arvore = None
    if arvore is not None:
        fora = set()
        for no in _ast.walk(arvore):
            corpo = getattr(no, "body", None)
            if not isinstance(corpo, list) or not corpo:
                continue
            d = corpo[0]
            if isinstance(d, _ast.Expr) and isinstance(getattr(d, "value", None), _ast.Constant) \
               and isinstance(d.value.value, str):
                for ln in range(d.lineno, (d.end_lineno or d.lineno) + 1):
                    fora.add(ln)
        txt = "\n".join("" if (i + 1) in fora else l
                        for i, l in enumerate(txt.split("\n")))
    import re as _re
    txt = _re.sub(r"/\*[\s\S]*?\*/", "", txt)
    return "\n".join(l for l in txt.split("\n")
                     if not l.strip().startswith(("#", "//", "*")))


arquivos = versionados()
# So CODIGO: arquivo que MENCIONA o provedor na docstring para explicar o incidente nao esta
# falando com ele. Este proprio gate era o exemplo.
# ESTE arquivo fica fora da propria varredura, e a razao e estrutural, nao conveniencia: um
# detector de "quem cita o provedor" precisa conter o nome do provedor no padrao. Nao ha como
# escrever o regex sem casar consigo mesmo. A exclusao e por caminho exato -- nao por prefixo --
# para nao virar uma porta por onde outro arquivo escape.
ESTE = "bolao/scripts/test_no_real_email_in_verification.py"

tocam = [f for f in arquivos
         if f != ESTE
         and PROVEDOR.search(_sem_docstrings((RAIZ / f).read_text(encoding="utf8", errors="replace")))]


def sem_remetente_novo():
    novos = [f for f in tocam if f not in REMETENTES]
    _assert(not novos,
            "caminho NAO registrado falando com o provedor:\n      " + "\n      ".join(novos) +
            "\n      Registre em REMETENTES com o motivo, ou tire a chamada. Um remetente que "
            "ninguem declarou e um remetente que ninguem revisou.")


test("todo caminho que fala com o provedor esta registrado", sem_remetente_novo)


def verificador_nao_envia():
    culpados = [f for f in tocam if E_VERIFICADOR.search(f) and f != "bolao/scripts/test_python_sender_failclosed.py"]
    _assert(not culpados,
            "arquivo de VERIFICACAO alcanca o provedor:\n      " + "\n      ".join(culpados) +
            "\n      Foi assim que o operador levou dois e-mails a mais em 2026-08-12.")


test("nenhum verificador (test_/audit_/canary/probe) fala com o provedor", verificador_nao_envia)


def canarios_do_cdb_nao_importam_envio():
    """Importar o sender e legitimo (o canario usa a emissao de credencial dele). Chamar
    `send_email` a partir de um canario nao e -- e a diferenca entre reusar codigo e disparar
    efeito colateral."""
    for nome in ("token_roundtrip_canary.py", "secure_access_canary.py"):
        p = RAIZ / "bolao/cdb2026/scripts" / nome
        if not p.exists():
            continue
        codigo = "\n".join(l for l in p.read_text(encoding="utf8").split("\n")
                           if not l.strip().startswith("#"))
        _assert("send_email(" not in codigo,
                f"{nome} chama send_email — canario nao envia e-mail, em nenhuma circunstancia")


test("os canarios do CDB nao chamam send_email", canarios_do_cdb_nao_importam_envio)


def disjuntor_existe_e_e_arquivo():
    ks = RAIZ / "bolao/cdb2026/EMAIL_KILL_SWITCH"
    sender = (RAIZ / "bolao/cdb2026/scripts/send_invitation_email.py").read_text(encoding="utf8")
    _assert("EMAIL_KILL_SWITCH" in sender,
            "o sender do CDB nao consulta o disjuntor")
    corpo = sender[sender.index("def send_email("):]
    corpo = corpo[:corpo.index("\ndef ", 1)] if "\ndef " in corpo[1:] else corpo
    _assert("kill_switch" in corpo.lower(),
            "o disjuntor nao e consultado DENTRO de send_email, antes do provedor")
    _assert(ks.exists(),
            "o arquivo do disjuntor sumiu. Se foi remocao deliberada, este gate deve ser "
            "atualizado no MESMO commit, para que ninguem o apague por acidente")


test("o disjuntor do CDB e um ARQUIVO e e consultado dentro de send_email",
     disjuntor_existe_e_e_arquivo)


def canarios_param_com_disjuntor():
    """Exige a guarda em CODIGO EXECUTAVEL, nao a palavra em qualquer lugar.

    A primeira versao aceitava a string aparecendo em qualquer parte do arquivo -- e eu tinha
    escrito EMAIL_KILL_SWITCH varias vezes na prosa explicando o incidente. A mutacao que
    apontava a guarda para um arquivo inexistente passou despercebida: a palavra continuava la,
    nos comentarios. Gate que le prosa mede prosa.
    """
    import re as _re
    for nome in ("token_roundtrip_canary.py", "secure_access_canary.py"):
        p = RAIZ / "bolao/cdb2026/scripts" / nome
        if not p.exists():
            continue
        bruto = p.read_text(encoding="utf8")
        # so linhas executaveis: fora comentarios e fora do docstring de modulo
        corpo = bruto.split('"""', 2)[-1] if bruto.count('"""') >= 2 else bruto
        codigo = "\n".join(l for l in corpo.split("\n") if not l.strip().startswith("#"))
        _assert(_re.search(r'EMAIL_KILL_SWITCH["\')]*\s*\)?\s*\.exists\(\)', codigo),
                f"{nome} nao TESTA a existencia do disjuntor em codigo executavel. Ele revoga "
                "credencial de gente real, e revogar exige outro e-mail para consertar.")
        _assert("exit(0)" in codigo or "sys.exit(0)" in codigo,
                f"{nome} detecta o disjuntor mas nao SAI — detectar sem parar nao contem nada")


test("os canarios PARAM enquanto o disjuntor estiver ativo", canarios_param_com_disjuntor)

print(f"\n  {ok} passed, {fail} failed\n")
print("✓ NO REAL EMAIL IN VERIFICATION PASSED\n" if fail == 0
      else "✗ NO REAL EMAIL IN VERIFICATION FAILED\n")
sys.exit(0 if fail == 0 else 1)
