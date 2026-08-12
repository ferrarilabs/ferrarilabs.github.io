#!/usr/bin/env python3
"""CDB2026 — o que pode virar resultado oficial, e o que nunca pode.

POR QUE ESTE GATE
-----------------
Resultado oficial move dinheiro: ele decide quem avança, quem pontua e quanto cada um recebe. A
ingestão automática lê um placar de um provedor externo e o grava como FINAL. Tudo que separa
"placar certo do jogo certo" de "placar de outro jogo com os mesmos nomes" é código.

O caso perigoso não é o provedor cair — é ele responder com um jogo PLAUSÍVEL: mesmos dois
clubes, outro ano, outra competição, outra fase. Cruzeiro × Atlético-MG acontece várias vezes por
temporada.

A REGRESSÃO TERMINAL
--------------------
`sb_save_leg()` sobrescreve sem perguntar. O que impede um placar já gravado de ser reescrito é
`_find_new_legs()`, que pula pernas com `goalsHome is not None`. Ou seja: a proteção existe em UMA
camada, num `continue`, e some sem barulho se alguém reorganizar aquele laço.

É exatamente a forma de defeito que este repositório já pagou caro — `retryable_recipients(...) or
esperados`, onde um `or` num lugar só reenviou e-mail para 15 pessoas. Uma invariante que vale
dinheiro não pode depender de ninguém lembrar dela.

HERMÉTICO: estado e candidatos são injetados. Sem rede, sem credencial, sem Supabase.

Uso: python3 bolao/cdb2026/scripts/test_trusted_result_ingestion.py
"""
import importlib.util
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
os.environ.setdefault("BOLAO_TEST_RUN", "1")

# Compila o TEXTO: o cache de bytecode do macOS vive fora do repo e invalida por (mtime, tamanho),
# então mutação de 1 char por 1 char pode servir bytecode velho e produzir gate falso-verde.
_FONTE = (AQUI / "send_result_email.py").read_text()
S = importlib.util.module_from_spec(importlib.util.spec_from_loader("sender", loader=None))
S.__file__ = str(AQUI / "send_result_email.py")
exec(compile(_FONTE, S.__file__, "exec"), S.__dict__)

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


KICKOFF = "2026-08-25T21:00:00-03:00"


def estado(goals=None, qualified=None):
    """Uma fase ativa, um confronto, perna de ida com kickoff conhecido."""
    m = {"kickoff": KICKOFF}
    if goals is not None:
        m.update({"goalsHome": goals[0], "goalsAway": goals[1], "status": "FINAL"})
    return {
        "espnSync": {"activePhaseId": "quartas"},
        "phases": {"quartas": {"ties": {"t1": {
            "teamA": "Cruzeiro", "teamB": "Atlético-MG",
            "qualifiedTeamId": qualified,
            "matches": {"first": m, "second": {"kickoff": "2026-09-01T21:00:00-03:00"}},
        }}}},
    }


def candidato(home="Cruzeiro", away="Atlético-MG", hs=2, aws=1, data="2026-08-25T21:00:00-03:00"):
    return {"homeTeam": home, "awayTeam": away, "homeScore": hs, "awayScore": aws, "dateISO": data}


def _assert(c, m):
    if not c:
        raise AssertionError(m)


def _sem_escrita_de_resultado_no_app():
    app = (AQUI.parent / "js" / "app.js").read_text()
    # `readTable` é leitura; a escrita passaria por upsert/patch na tabela crua.
    import re
    for l in app.split("\n"):
        if re.search(r"(upsert|\.patch\(|method:\s*[\"']PATCH)", l) and "bolao_state" in l:
            return False
    return True


print("\nCDB2026 — ingestão confiável de resultado\n")

# ── o caminho feliz tem de funcionar (senão o resto não prova nada) ──────────────────────────
test("jogo CERTO, times certos, data certa -> ingerido", lambda: _assert(
    len(S._find_new_legs(estado(), [candidato()])) == 1,
    "o caminho válido parou de funcionar — um gate que só sabe recusar não prova nada"))

# ── §18 identidade do confronto ─────────────────────────────────────────────────────────────
# MANDO INVERTIDO — o que se pode afirmar aqui, e o que não.
#
# Escrevi este caso primeiro como "mando invertido -> recusado" e ele reprovou. Investigando: num
# confronto de ida e volta, Atlético-MG × Cruzeiro NÃO é o jogo errado — é a VOLTA, cujo mando é
# exatamente o inverso da ida. O casamento encontrou a perna certa, não uma perna errada.
#
# A afirmação correta é mais estreita: o placar com mando invertido não pode ser gravado como a
# IDA. Se fosse, os gols entrariam trocados de lado e o agregado sairia invertido — placar certo,
# confronto certo, resultado errado.
test("mando invertido NÃO é gravado como a IDA", lambda: _assert(
    all(leg != "first" for (_, _, leg, *_) in
        S._find_new_legs(estado(), [candidato(home="Atlético-MG", away="Cruzeiro")])),
    "gravou o jogo da volta como se fosse a ida — os gols entram trocados de lado e o agregado "
    "aponta o classificado errado"))

test("time ERRADO no confronto -> NÃO ingerido", lambda: _assert(
    S._find_new_legs(estado(), [candidato(away="Flamengo")]) == [],
    "aceitou placar de um confronto que não existe nesta chave"))

test("ano ERRADO, mesmos clubes -> NÃO ingerido", lambda: _assert(
    S._find_new_legs(estado(), [candidato(data="2025-08-25T21:00:00-03:00")]) == [],
    "aceitou Cruzeiro x Atlético-MG de OUTRA temporada — esses dois se enfrentam várias vezes "
    "por ano, e a janela de data é a única coisa que separa um jogo do outro"))

test("mesma temporada, fase MUITO distante -> NÃO ingerido", lambda: _assert(
    S._find_new_legs(estado(), [candidato(data="2026-03-10T21:00:00-03:00")]) == [],
    "aceitou um clássico de março como se fosse a ida das quartas de agosto"))

test("dentro da janela (mesma rodada, dia adjacente) -> ingerido", lambda: _assert(
    len(S._find_new_legs(estado(), [candidato(data="2026-08-26T21:30:00-03:00")])) == 1,
    "recusou um adiamento de um dia — jogo adiado dentro da mesma rodada continua sendo o jogo"))

# ── §18 estado do jogo ──────────────────────────────────────────────────────────────────────
test("jogo SEM placar (agendado) -> NÃO ingerido", lambda: _assert(
    S._find_new_legs(estado(), [candidato(hs=None)]) == [],
    "tratou jogo agendado como resultado"))

# O adversário do candidato tem de ser "" TAMBÉM, senão o teste não mede nada: com teamB vazio, o
# casamento por nome já falharia sozinho contra qualquer candidato normal, e a guarda de confronto
# não-sorteado poderia ser removida sem que ninguém notasse. Medido: a primeira versão deste caso
# passava com a guarda deletada.
test("confronto sem os dois times definidos -> NÃO ingerido", lambda: (
    lambda st: (st["phases"]["quartas"]["ties"]["t1"].update({"teamB": ""}),
                _assert(S._find_new_legs(st, [candidato(away="")]) == [],
                        "ingeriu contra um confronto ainda não sorteado: um feed que devolva "
                        "nome vazio casaria com o lado vazio da chave")))(estado()))

# ── §18 REGRESSÃO TERMINAL — a invariante que vale dinheiro ─────────────────────────────────
test("perna JÁ GRAVADA nunca é reescrita (regressão terminal)", lambda: _assert(
    S._find_new_legs(estado(goals=(2, 1)), [candidato(hs=9, aws=0)]) == [],
    "reescreveu um placar FINAL já gravado. sb_save_leg() sobrescreve sem perguntar; o "
    "`continue` de _find_new_legs é a ÚNICA camada que impede isso, e acabou de sumir"))

test("confronto TRAVADO não é redecidido", lambda: _assert(
    S._maybe_decide_tie(estado(goals=(2, 1), qualified="A"), "quartas", "t1", [candidato()]) is None,
    "redecidiu um confronto já travado — quem avança já foi comunicado e pago"))

# ── §18 escopo: só a fase ativa ─────────────────────────────────────────────────────────────
test("fase ativa AUSENTE -> nada é ingerido", lambda: (
    lambda st: (st.__setitem__("espnSync", {}),
                _assert(S._find_new_legs(st, [candidato()]) == [],
                        "ingeriu sem saber qual fase está viva")))(estado()))

test("fase ativa DESCONHECIDA -> nada é ingerido", lambda: (
    lambda st: (st.__setitem__("espnSync", {"activePhaseId": "fase-inventada"}),
                _assert(S._find_new_legs(st, [candidato()]) == [],
                        "aceitou um id de fase que não existe no torneio")))(estado()))

# ── o travamento é idempotente ──────────────────────────────────────────────────────────────
test("sb_lock_tie recusa sobrescrever confronto travado", lambda: _assert(
    "if tie.get(\"qualifiedTeamId\"):" in _FONTE and "never overwrite" in _FONTE,
    "sumiu a guarda de não sobrescrever confronto travado em sb_lock_tie"))

# ── o navegador não participa disso ─────────────────────────────────────────────────────────
test("nenhuma gravação de resultado parte do navegador", lambda: _assert(
    _sem_escrita_de_resultado_no_app(),
    "o app.js voltou a gravar resultado oficial. Desde a migração 20260812080000 a anon nem "
    "alcança a linha crua do cdb2026 — mas o código não pode depender só disso"))


print(f"\n  {ok} passed, {fail} failed\n")
print("✓ TRUSTED RESULT INGESTION PASSED\n" if fail == 0 else "✗ TRUSTED RESULT INGESTION FAILED\n")
sys.exit(0 if fail == 0 else 1)
