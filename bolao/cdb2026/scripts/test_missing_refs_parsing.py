#!/usr/bin/env python3
"""test_missing_refs_parsing.py — validação léxica de `missing_refs` (#400).

O que este gate protege: a entrada `missing_refs` do workflow vira argumento de um comando que
manda e-mail para participantes reais. Esta é a PRIMEIRA das duas camadas — aqui só a FORMA
(vazio, formato, duplicata, teto, metacaractere de shell, quebra de linha). A camada SEMÂNTICA
(o ref existe? já foi entregue? é exatamente o conjunto faltante do ledger?) é do
`recover_result_email.py`, com gate próprio em `test_partial_result_email_recovery.py`.

As duas são independentes de propósito: esta não alcança o ledger, e aquela não confia na forma.

O alvo é `build_missing_ref_args.sh`. Ele existe como ARQUIVO, e não como seis linhas dentro do
`run:` do workflow, exatamente para poder ser exercitado aqui: nenhum gate consegue testar um
bloco de shell embutido em YAML.
"""
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ALVO = AQUI / "build_missing_ref_args.sh"

ok = 0
fail = 0


def executar(entrada, teto="50", script=None):
    """Roda o script com MISSING_REFS=<entrada>. Devolve (returncode, stdout, stderr)."""
    r = subprocess.run(["bash", str(script or ALVO)],
                       env={"MISSING_REFS": entrada, "MAX_MISSING_REFS": teto, "PATH": "/usr/bin:/bin"},
                       capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


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


def aceita(entrada, esperado):
    st, out, err = executar(entrada)
    _assert(st == 0, f"recusou entrada válida (exit {st}): {err.strip()}")
    _assert(out.split() == esperado, f"saída {out.split()} != esperado {esperado}")


def recusa(entrada, teto="50"):
    st, out, _ = executar(entrada, teto)
    _assert(st != 0, f"ACEITOU entrada que devia recusar; emitiu {out.split()}")


SEIS = ["03e9fe14-d777-4a71-9c31-3d54dd21a07c", "2a0eb9e8-7210-4645-aa45-016f7abfa776",
        "3ea26fa2-828d-49e5-81e5-11a15f23f168", "3954c9f0-6c4c-4b84-b3f3-05cb8333c545",
        "09959213-3e1b-4eaa-a22c-9f4c93445bad", "697ff5e5-2304-40a4-a803-d198c1032b0a"]

print("\nmissing_refs — validação léxica\n")
print("A. Entrada válida")

test("seis refs UUID => seis tokens, na ordem dada", lambda: aceita(" ".join(SEIS), SEIS))
test("espaços extras não mudam o resultado",
     lambda: aceita(f"   {SEIS[0]}    {SEIS[1]}  ", SEIS[:2]))
test("slug curto também é aceito (entry id nem sempre é UUID)",
     lambda: aceita("e7 e8", ["e7", "e8"]))

print("\nB. Ordem não enfraquece a validação de conjunto")


def _ordem_e_transporte():
    """A ordem aqui é transporte; quem decide o CONJUNTO é o Python, por igualdade de conjunto
    contra o faltante do ledger. Esta camada só não pode reordenar nem descartar."""
    _, direto, _ = executar(" ".join(SEIS))
    _, invertido, _ = executar(" ".join(reversed(SEIS)))
    _assert(sorted(direto.split()) == sorted(invertido.split()),
            "ordem trocada produziu conjunto diferente")
    _assert(len(direto.split()) == 6 and len(invertido.split()) == 6, "perdeu token")


test("ordem trocada produz o MESMO conjunto", _ordem_e_transporte)

print("\nC. Recusas")

for nome, entrada, teto in [
    ("vazio", "", "50"),
    ("só espaços", "     ", "50"),
    ("ref duplicado", "e7 e8 e7", "50"),
    ("duplicado entre os seis UUIDs", " ".join(SEIS + [SEIS[0]]), "50"),
    ("acima do teto (7 com teto 6)", "a b c d e f g", "6"),
    ("ref começando com hífen (viraria flag)", "--send e8", "50"),
    ("ponto e vírgula", "e7; rm -rf /", "50"),
    ("substituição de comando $()", "e7 $(whoami)", "50"),
    ("crase", "e7 `id`", "50"),
    ("pipe", "e7|cat", "50"),
    ("&&", "e7 && echo x", "50"),
    ("aspas", 'e7 "e8"', "50"),
    ("barra (caminho)", "e7 ../../etc/passwd", "50"),
    ("@ (parece e-mail — ref nunca é endereço)", "alguem@exemplo.invalid", "50"),
    ("ref longo demais (>64)", "a" * 65, "50"),
    ("quebra de linha (truncava a lista em silêncio)", "e7\ne8", "50"),
    ("carriage return", "e7\re8", "50"),
]:
    test(f"recusa: {nome}", lambda e=entrada, t=teto: recusa(e, t))

print("\nD. O token perigoso não volta no erro")


def _nao_ecoa():
    _, _, err = executar("e7; rm -rf /")
    _assert("rm -rf" not in err, f"a mensagem de erro ecoa o token: {err.strip()}")


test("a mensagem de erro não ecoa o token", _nao_ecoa)

print("\nE. Controle negativo — a validação TEM de morder")


def _mutante_sem_regex():
    """Sem a checagem de formato, um token com metacaractere passaria. Prova que é a regex que
    protege, e não um efeito colateral de outra linha."""
    fonte = ALVO.read_text()
    alvo_linha = '  if ! [[ "$t" =~ $REF_RE ]]; then'
    _assert(alvo_linha in fonte, "a mutação não encontrou a checagem de formato")
    mutante = AQUI / ".mutante_missing_refs.sh"
    try:
        mutante.write_text(fonte.replace(alvo_linha, "  if false; then", 1))
        st, out, _ = executar("e7; rm -rf /", script=mutante)
        _assert(st == 0, "o mutante ainda recusa — a proteção real está noutro lugar")
        _assert("rm" in out, f"o mutante devia emitir o token cru, emitiu {out.split()}")
    finally:
        mutante.unlink(missing_ok=True)


test("MUTAÇÃO: sem a checagem de formato, o token perigoso passaria", _mutante_sem_regex)


def _mutante_sem_guarda_de_newline():
    """Sem a recusa de quebra de linha, `read -ra` com here-string lê só a PRIMEIRA linha e a
    lista é truncada em silêncio — uma recuperação parcial reportada como completa."""
    fonte = ALVO.read_text()
    alvo_linha = "  *$'\\n'*|*$'\\r'*) erro"
    _assert(alvo_linha in fonte, "a mutação não encontrou a guarda de quebra de linha")
    mutante = AQUI / ".mutante_newline.sh"
    try:
        mutante.write_text(fonte.replace(alvo_linha, "  *__nunca__) erro", 1))
        st, out, _ = executar("e7\ne8", script=mutante)
        _assert(st == 0 and out.split() == ["e7"],
                f"sem a guarda o mutante devia truncar para ['e7'], deu st={st} out={out.split()}")
    finally:
        mutante.unlink(missing_ok=True)


test("MUTAÇÃO: sem a guarda de newline, a lista seria truncada em silêncio",
     _mutante_sem_guarda_de_newline)

print(f"\n  {ok} passed, {fail} failed\n")
print("✗ MISSING_REFS PARSING FAILED" if fail else "✓ MISSING_REFS PARSING OK")
sys.exit(1 if fail else 0)
