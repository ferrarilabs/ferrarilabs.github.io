#!/usr/bin/env python3
"""test_partial_result_email_recovery.py — recuperação PARCIAL de e-mail de resultado (#400).

─── O CASO REAL ────────────────────────────────────────────────────────────────────────────────

2026-09-03: uma sessão de envio processou Vasco × Vitória inteiro (12/12, 02:40:08→02:40:59Z) e
morreu no meio do lote seguinte. Palmeiras × Santos saiu para os destinatários #1..#6
(02:41:16→02:41:39Z) e parou. Os seis restantes nunca receberam. O ledger registrou isso
corretamente: `SENT=6, PENDING=6`.

O caminho de recuperação TOTAL não serve para isso, e está certo em não servir: ele só age quando
NINGUÉM recebeu, e então envia para TODOS. Apontá-lo a este alvo mandaria e-mail duplicado para os
seis que já receberam — o incidente #221 (rodada 23 enviada 4× para 11 pessoas reais).

─── O QUE ESTE GATE PROVA ──────────────────────────────────────────────────────────────────────

Que o caminho PARCIAL entrega ao subconjunto comprovadamente faltante e é incapaz de tocar quem já
recebeu. A prova que mais importa é a de INALCANÇABILIDADE: o conjunto que `main()` reserva e
percorre é `refs`, e no caminho parcial `refs` é ESTREITADO no preflight para os refs autorizados.
Um ref já entregue nunca entra no dicionário — não há o que filtrar depois, e um refactor no laço
de envio não consegue reintroduzi-lo.

As mutações no fim provam que o gate REPROVA quando a proteção é removida ou contornada. Um gate
que nunca falha não protege nada.

Hermético: sem rede, sem provedor, sem participante. `BOLAO_TEST_RUN=1` mantém `send_email()`
fail-closed mesmo se algum caminho chamasse por engano.
"""
import importlib.util
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
os.environ.setdefault("BOLAO_TEST_RUN", "1")
sys.path.insert(0, str(AQUI))
sys.path.insert(0, str(AQUI.parent.parent / "shared" / "scripts"))

_FONTE = (AQUI / "recover_result_email.py").read_text()


def carregar(fonte=None):
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("rec", loader=None))
    mod.__file__ = str(AQUI / "recover_result_email.py")
    exec(compile(fonte or _FONTE, mod.__file__, "exec"), mod.__dict__)
    return mod


R = carregar()
S = R._carregar_sender()

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


# ─── Fixture: 12 destinatários, o formato exato do incidente (6 entregues, 6 não) ──────────────
ALVO = ("quartas", "espn-palmeiras_santos", "second")
ENTRADAS = [{"id": f"e{i}", "participantName": f"P{i}", "participantEmail": f"e{i}@exemplo.invalid"}
            for i in range(1, 13)]
ENTREGUES = [f"e{i}" for i in range(1, 7)]      # #1..#6 — confirmados no provedor
FALTANTES = [f"e{i}" for i in range(7, 13)]     # #7..#12 — ausentes


def estado():
    def jogo(r, home, away):
        m = {"kickoff": "2026-09-03T00:30:00Z", "homeTeam": home, "awayTeam": away}
        if r is not None:
            m.update({"goalsHome": r[0], "goalsAway": r[1], "status": "FINAL"})
        return m
    return {
        "espnSync": {"activePhaseId": "quartas"},
        "entries": [dict(e) for e in ENTRADAS],
        "deletedIds": [],
        "phases": {"quartas": {"ties": {
            ALVO[1]: {"teamA": "Palmeiras", "teamB": "Santos", "qualifiedTeamId": None,
                      "matches": {"first": jogo((3, 0), "Palmeiras", "Santos"),
                                  "second": jogo((0, 0), "Santos", "Palmeiras")}},
        }}},
    }


class LedgerFalso:
    def __init__(self, linhas=None):
        self.linhas = linhas or []
        self.reservas, self.marcados = [], []

    def status_rows(self):
        return list(self.linhas)

    def reserve(self, p, t, l, refs):
        self.reservas.append((f"{p}:{t}:{l}", tuple(sorted(refs))))

    def mark_sent(self, p, t, l, ref, status=None):
        self.marcados.append((f"{p}:{t}:{l}", ref))


def chave(ref):
    from result_email_ledger import idempotency_key
    return idempotency_key(ALVO[0], ALVO[1], ALVO[2], ref)


def ledger_do_incidente():
    """6 `sent` + 6 `pending` — exatamente o que a produção mostra para este alvo."""
    return LedgerFalso([(chave(r), "sent") for r in ENTREGUES]
                       + [(chave(r), "pending") for r in FALTANTES])


def pre(autorizados=None, ledger=None, mod=None, expect="0-0"):
    M = mod or R
    return M.preflight(S, ALVO[0], ALVO[1], ALVO[2], expect,
                       ledger=ledger if ledger is not None else ledger_do_incidente(),
                       state=estado(), autorizados=autorizados)


print("\nRecuperação PARCIAL — o subconjunto faltante, e só ele\n")
print("A. O caminho parcial não abre sozinho")


def _sem_autorizacao_continua_uncertain():
    ev, _, _ = pre(autorizados=None)
    _assert(ev["TARGET_STATUS"] == R.UNCERTAIN,
            f"sem refs autorizados o alvo tem de continuar {R.UNCERTAIN}, veio {ev['TARGET_STATUS']}")
    _assert(ev["WOULD_SEND_COUNT"] == 6, ev["WOULD_SEND_COUNT"])


test("pendência no ledger, sozinha, NÃO abre recuperação (continua UNCERTAIN)",
     _sem_autorizacao_continua_uncertain)


def _lista_vazia_recusa():
    ev, _, refs = pre(autorizados=set())
    _assert(ev["TARGET_STATUS"] != R.READY_PARTIAL, ev["TARGET_STATUS"])
    _assert(refs is None, "não pode devolver alvo de envio")


test("lista de refs vazia => recusa", _lista_vazia_recusa)


def _as_duas_metades_andam_juntas():
    fonte = R.main.__globals__["__file__"]  # noqa: F841 — só para ancorar o módulo
    codigo = _FONTE
    _assert("--missing-ref" in codigo and "--confirm-not-delivered" in codigo,
            "faltam os dois argumentos do caminho parcial")
    _assert("bool(a.missing_ref) != bool(a.confirm_not_delivered)" in codigo,
            "refs sem afirmação de evidência (ou vice-versa) tem de recusar")


test("exige refs E afirmação de evidência externa — nunca só um dos dois",
     _as_duas_metades_andam_juntas)


print("\nB. O alvo é exatamente o subconjunto faltante")


def _alvo_exato():
    ev, _, refs = pre(autorizados=set(FALTANTES))
    _assert(ev["TARGET_STATUS"] == R.READY_PARTIAL, f"{ev['TARGET_STATUS']} — {ev['MOTIVO']}")
    _assert(ev["WOULD_SEND_COUNT"] == 6, ev["WOULD_SEND_COUNT"])
    _assert(sorted(refs) == sorted(FALTANTES), sorted(refs))
    _assert(ev["EXPECTED_RECIPIENT_COUNT"] == 12, ev["EXPECTED_RECIPIENT_COUNT"])


test("6 refs faltantes autorizados => READY_PARTIAL com alvo de exatamente 6", _alvo_exato)


def _entregues_fora_do_alvo():
    _, _, refs = pre(autorizados=set(FALTANTES))
    vazou = sorted(set(refs) & set(ENTREGUES))
    _assert(not vazou, f"ref já entregue entrou no alvo de envio: {vazou}")


test("nenhum dos 6 já entregues aparece no alvo de envio", _entregues_fora_do_alvo)


def _subconjunto_menor_permitido():
    ev, _, refs = pre(autorizados={"e7", "e8"})
    _assert(ev["TARGET_STATUS"] == R.READY_PARTIAL, ev["TARGET_STATUS"])
    _assert(sorted(refs) == ["e7", "e8"], sorted(refs))


test("autorizar menos que o faltante é permitido (conservador), e mira só esses",
     _subconjunto_menor_permitido)


def _refs_expostos_no_preflight():
    """O operador precisa passar os refs exatos em `--missing-ref`, e o único lugar que sabe quais
    são é este preflight (ledger e resolução de destinatário exigem credencial de operador). Se ele
    não os imprimir, a lista só sairia de inferência sobre ordem de entrada — palpite, num comando
    que manda e-mail para gente real."""
    ev, _, _ = pre(autorizados=None)
    _assert(ev["WOULD_SEND_REFS"] == " ".join(sorted(FALTANTES)), ev["WOULD_SEND_REFS"])
    _assert("WOULD_SEND_REFS" in _FONTE.split("def imprimir")[1],
            "WOULD_SEND_REFS existe mas não é impresso — o operador não teria como obtê-lo")
    for r in ENTREGUES:
        _assert(r not in ev["WOULD_SEND_REFS"].split(), f"ref entregue {r} listado como faltante")


test("o preflight EXPÕE os refs faltantes (é a entrada de --missing-ref)",
     _refs_expostos_no_preflight)


print("\nC. A guarda estrutural — ref já entregue é INALCANÇÁVEL")


def _entregue_aborta_nao_filtra():
    """Autorizar um entregue tem de ABORTAR. Filtrar em silêncio viraria 'recuperei' com gente
    ainda sem e-mail — e o operador nunca saberia que errou o conjunto."""
    ev, _, refs = pre(autorizados=set(FALTANTES) | {"e1"})
    _assert(ev["TARGET_STATUS"] == R.NOT_READY,
            f"autorizar um ref ENTREGUE tem de recusar, veio {ev['TARGET_STATUS']}")
    _assert("e1" in ev["MOTIVO"], ev["MOTIVO"])
    _assert(refs is None, "não pode devolver alvo de envio quando o conjunto é inválido")


test("autorizar um ref JÁ ENTREGUE aborta (não filtra em silêncio)", _entregue_aborta_nao_filtra)


def _so_entregues_aborta():
    ev, _, refs = pre(autorizados=set(ENTREGUES))
    _assert(ev["TARGET_STATUS"] == R.NOT_READY, ev["TARGET_STATUS"])
    _assert(refs is None, refs)


test("autorizar SÓ refs já entregues aborta", _so_entregues_aborta)


def _ref_inexistente_aborta():
    ev, _, refs = pre(autorizados={"e7", "ref-que-nao-existe"})
    _assert(ev["TARGET_STATUS"] != R.READY_PARTIAL, ev["TARGET_STATUS"])
    _assert(refs is None, refs)


test("ref sem destinatário resolvível aborta", _ref_inexistente_aborta)


def _reserva_e_envio_miram_o_mesmo_conjunto():
    """`main()` reserva e percorre `refs`. Se o preflight estreitou, os dois seguem estreitos —
    é isso que torna 'já entregue' inalcançável sem depender de disciplina no laço."""
    codigo = _FONTE
    _assert("reg.reserve(a.phase, a.tie, a.leg, sorted(refs))" in codigo,
            "a reserva deixou de mirar `refs`")
    _assert("for ref in sorted(refs):" in codigo, "o laço de envio deixou de mirar `refs`")
    _assert("refs = {r: refs[r] for r in sorted(alvo)}" in codigo,
            "o preflight deixou de ESTREITAR `refs` — a proteção passaria a depender do laço")


test("reserva e envio miram `refs`, e `refs` é estreitado no preflight",
     _reserva_e_envio_miram_o_mesmo_conjunto)


def _reassercao_antes_de_reservar():
    _assert('ev.get("_SENT_REFS") and (set(refs) & ev["_SENT_REFS"])' in _FONTE,
            "sumiu a reasserção de interseção antes de reservar/enviar")


test("há reasserção de interseção imediatamente antes de reservar", _reassercao_antes_de_reservar)


print("\nD. Nada além de e-mail")


def _nao_toca_competicao():
    """O caminho de recuperação lê estado e escreve ledger. Nada de placar, qualificação,
    entrada, pagamento ou persistência de resultado."""
    # LER estado de competicao e obrigatorio (o preflight compara o placar esperado com o
    # gravado -- `jogo.get("goalsHome")` e uma GUARDA). O que nao pode existir e ESCRITA.
    codigo = "\n".join(l.split("#")[0] for l in _FONTE.split("\n"))
    escritas = ["sb_save", "save_leg", "apply_operator", "sb_update", "sb_clear",
                "espn-save-result", '"PATCH"', "requests.post", "cdb_apply_operator_mutation"]
    for p in escritas:
        _assert(p not in codigo, f"o recuperador referencia `{p}` — ele só manda e-mail")
    # E nenhuma ATRIBUICAO a campo de competicao.
    import re as _re
    for campo in ["goalsHome", "goalsAway", "qualifiedTeamId", "lockedBy", "status", "paid"]:
        atrib = _re.search(rf'\[["\']{campo}["\']\]\s*=', codigo)
        _assert(atrib is None, f"o recuperador ATRIBUI `{campo}` — ele só manda e-mail")


test("não escreve scoring, resultado, qualificação, entrada nem pagamento", _nao_toca_competicao)


def _log_sem_pii():
    for l in _FONTE.split("\n"):
        if "print(" in l and "addr" in l:
            raise AssertionError(f"linha imprime endereço: {l.strip()}")
    _assert("entry_ref=" in _FONTE, "o log precisa identificar por entry_ref")


test("log continua ref-based, nunca endereço (#397)", _log_sem_pii)


print("\nE. Controle negativo — a proteção TEM de morder")


def _defesa_em_profundidade():
    """Duas guardas independentes barram um ref já entregue: a interseção com `sent`, e a
    exigência de que todo autorizado esteja em `faltando` (um entregue nunca está). Remover UMA
    ainda barra — e isso é uma propriedade, não um acidente: vale a pena prová-la."""
    so_sem_interseccao = _FONTE.replace("        ja_entregues = sorted(alvo & sent)",
                                        "        ja_entregues = []")
    _assert(so_sem_interseccao != _FONTE, "a mutação não encontrou a guarda de interseção")
    M = carregar(so_sem_interseccao)
    ev, _, refs = pre(autorizados=set(FALTANTES) | {"e1"}, mod=M)
    _assert(ev["TARGET_STATUS"] != M.READY_PARTIAL and refs is None,
            "removida a interseção, a guarda de `faltando` ainda deveria barrar")


test("defesa em profundidade: remover UMA das duas guardas ainda barra o entregue",
     _defesa_em_profundidade)


def _mutante_sem_as_duas_guardas():
    """A mutação honesta: removidas AS DUAS, o ref entregue passa. É isso que prova que o par é
    o que protege — e que o gate reprovaria um patch que apagasse ambas."""
    mutante = (_FONTE
               .replace("        ja_entregues = sorted(alvo & sent)", "        ja_entregues = []")
               .replace("        fora_do_faltando = sorted(alvo - set(faltando))",
                        "        fora_do_faltando = []"))
    _assert(mutante != _FONTE, "a mutação não encontrou as guardas")
    M = carregar(mutante)
    ev, _, refs = pre(autorizados=set(FALTANTES) | {"e1"}, mod=M)
    _assert(ev["TARGET_STATUS"] == M.READY_PARTIAL and refs is not None and "e1" in refs,
            "sem AS DUAS guardas o mutante deveria aceitar o ref entregue — se não aceita, "
            "a proteção real está noutro lugar e este gate não prova o que diz")


test("MUTAÇÃO: sem AS DUAS guardas, um ref entregue seria aceito",
     _mutante_sem_as_duas_guardas)


def _mutante_sem_estreitamento():
    """Remove o estreitamento de `refs`. O alvo de envio voltaria a ser os 12."""
    mutante = _FONTE.replace("        refs = {r: refs[r] for r in sorted(alvo)}",
                             "        refs = dict(refs)")
    _assert(mutante != _FONTE, "a mutação não encontrou o estreitamento")
    M = carregar(mutante)
    _, _, refs = pre(autorizados=set(FALTANTES), mod=M)
    _assert(len(refs) == 12,
            f"sem o estreitamento o alvo deveria voltar a 12, veio {len(refs)} — "
            "logo o estreitamento real é o que protege")


test("MUTAÇÃO: sem o estreitamento, o alvo volta a ser os 12", _mutante_sem_estreitamento)


def _mutante_pendencia_abre_sozinha():
    """Se `READY_PARTIAL` pudesse ser alcançado sem refs autorizados, pendência viraria licença
    para enviar — exatamente o que a #400 proíbe."""
    _assert("if autorizados is not None:" in _FONTE,
            "o caminho parcial deixou de exigir refs autorizados explícitos")
    ev, _, _ = pre(autorizados=None)
    _assert(ev["TARGET_STATUS"] != R.READY_PARTIAL,
            "READY_PARTIAL alcançado sem autorização explícita")


test("MUTAÇÃO/forma: READY_PARTIAL é inalcançável sem refs autorizados",
     _mutante_pendencia_abre_sozinha)


print(f"\n  {ok} passed, {fail} failed\n")
print("✗ RECUPERACAO PARCIAL REPROVADA" if fail else "✓ RECUPERACAO PARCIAL OK")
sys.exit(1 if fail else 0)
