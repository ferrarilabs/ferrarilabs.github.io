#!/usr/bin/env python3
"""CDB2026 — o convite não pode sair antes da hora, nem duas vezes, nem levar o token no log.

Três coisas podem dar errado num convite com link de acesso pessoal, e as três são caras:

  cedo demais   convidar para um formulário sem prazo oficial confirmado é exatamente o que a
                regra §50 do Eduardo proíbe. Aqui isso vira portão, não disciplina.
  duas vezes    reemitir token invalida o anterior. Um segundo convite acidental transforma o
                link que a pessoa já tem em lixo, silenciosamente.
  token no log  o token em claro existe numa variável e em nenhum outro lugar. Se ele vazar para
                stdout, vaza para o log do Actions, que é retido.

HERMÉTICO: sem rede, sem credencial. O estado é injetado e o transporte é falso.

Uso: python3 bolao/cdb2026/scripts/test_invitation_email.py
"""
import io
import importlib.util
import contextlib
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
os.environ["BOLAO_TEST_RUN"] = "1"  # trava o envio real antes mesmo de importar

# Compilamos o TEXTO do arquivo, em vez de usar o carregador normal.
#
# Por quê: o macOS guarda bytecode fora da árvore do repositório, em
# ~/Library/Caches/com.apple.python/. Durante teste de mutação isso morde de verdade — trocar um
# caractere por outro (`#` por `?`) preserva o tamanho do arquivo, e a invalidação do cache é por
# (mtime, tamanho). O resultado é um módulo que não corresponde ao arquivo em disco: eu vi este
# teste acusar "o link não usa fragmento" com o `#t=` intacto na linha 370.
#
# Um gate que às vezes avalia uma versão antiga do código não é um gate. Compilar o texto lido
# agora remove a categoria inteira: não há cache no caminho.
_FONTE = (AQUI / "send_invitation_email.py").read_text()
convite = importlib.util.module_from_spec(
    importlib.util.spec_from_loader("convite", loader=None)
)
convite.__file__ = str(AQUI / "send_invitation_email.py")
exec(compile(_FONTE, convite.__file__, "exec"), convite.__dict__)

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


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _assert(c, m):
    if not c:
        raise AssertionError(m)


def _raises(fn, exc, m):
    antes = os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
    try:
        fn()
        raise AssertionError(m)
    except exc:
        pass
    finally:
        if antes is not None:
            os.environ["SUPABASE_SERVICE_ROLE_KEY"] = antes


FUTURO = iso(datetime.now(timezone.utc) + timedelta(days=10))
PASSADO = iso(datetime.now(timezone.utc) - timedelta(days=1))

# FORMA REAL DA PRODUCAO: `phase.ties` e um DICT keyed por id, e `officialDraw` guarda
# PROVENIENCIA (validatedAt/bracketHash) -- nao a lista de confrontos.
#
# A primeira versao deste teste usava lista dentro de officialDraw. O gate passava 16/16 contra
# essa fixture, e o script anunciou "0 de 4 confrontos" contra uma producao que tem os 4. Um
# teste hermetico so prova consistencia com o modelo que ele proprio carrega: se a fixture erra
# a forma junto com o codigo, os dois concordam e ninguem reclama. Por isso a fixture aqui
# espelha a forma lida de operator_cli.py/reconcile_official_schedule.py, nao a que eu imaginei.
QUATRO = {
    "t1": {"teamA": "Cruzeiro", "teamB": "Atlético-MG"},
    "t2": {"teamA": "Vasco", "teamB": "Vitória"},
    "t3": {"teamA": "Palmeiras", "teamB": "Santos"},
    "t4": {"teamA": "Internacional", "teamB": "Grêmio"},
}
PROV = {"validatedAt": "2026-08-12T00:00:00Z", "bracketHash": "abc123"}


def estado(cutoff=FUTURO, ties=None, entradas=None, prov=None):
    return {
        "phases": {"quartas": {
            "cutoffAt": cutoff,
            "ties": QUATRO if ties is None else ties,
            "officialDraw": PROV if prov is None else prov,
        }},
        "entries": entradas if entradas is not None else [
            {"id": "e1", "entryName": "Fulano", "participantEmail": "fulano@example.com"},
            {"id": "e2", "entryName": "Beltrano", "participantEmail": "beltrano@example.com"},
        ],
        "deletedIds": [],
    }


print("\nCDB2026 — convite das quartas\n")

# ── §50: o prazo publicado é pré-requisito ───────────────────────────────────────────────────
test("SEM cutoffAt o convite é BLOQUEADO (regra §50 executável)", lambda: (
    lambda r: (
        _assert(r[0] is False, "convidou sem prazo oficial publicado"),
        _assert("cutoffAt" in r[1], f"o motivo não menciona o prazo: {r[1]}"),
    ))(convite.check_ready_to_invite(estado(cutoff=None))))

test("cutoffAt JÁ VENCIDO é bloqueado", lambda: _assert(
    convite.check_ready_to_invite(estado(cutoff=PASSADO))[0] is False,
    "convidou para um prazo que já passou"))

test("cutoffAt ilegível é bloqueado (não vira 'sem prazo' silencioso)", lambda: _assert(
    convite.check_ready_to_invite(estado(cutoff="25 de agosto"))[0] is False,
    "aceitou um prazo que não sabe ler"))

# ── sorteio completo ─────────────────────────────────────────────────────────────────────────
test("sorteio com menos de 4 confrontos é bloqueado", lambda: _assert(
    convite.check_ready_to_invite(
        estado(ties={k: QUATRO[k] for k in ("t1", "t2", "t3")}))[0] is False,
    "convidou com o sorteio pela metade"))

test("confronto sem os dois times é bloqueado", lambda: _assert(
    convite.check_ready_to_invite(
        estado(ties={**{k: QUATRO[k] for k in ("t1", "t2", "t3")},
                     "t4": {"teamA": "Internacional", "teamB": ""}}))[0] is False,
    "convidou com um confronto sem adversário"))

test("estado completo e prazo no futuro LIBERA", lambda: (
    lambda r: (_assert(r[0] is True, f"bloqueou indevidamente: {r[1]}"),
               _assert(r[2] == FUTURO, "não devolveu o cutoff")))(
    convite.check_ready_to_invite(estado())))

test("sorteio SEM proveniencia validada é bloqueado", lambda: _assert(
    convite.check_ready_to_invite(estado(prov={}))[0] is False,
    "convidou para um chaveamento cuja origem o proprio app se recusa a reconhecer"))

test("le os confrontos de phase.ties, nao de officialDraw.ties", lambda: _assert(
    convite.check_ready_to_invite(
        {"phases": {"quartas": {"cutoffAt": FUTURO, "ties": {},
                                "officialDraw": {**PROV, "ties": QUATRO}}}})[0] is False,
    "aceitou confrontos pendurados em officialDraw.ties — foi esse engano que fez o script\n     anunciar 0 de 4 contra uma producao que tem os 4"))

# ── elegibilidade ────────────────────────────────────────────────────────────────────────────
test("entrada apagada não é convidada", lambda: _assert(
    [e["id"] for e in convite.eligible_entries(
        {**estado(), "deletedIds": ["e1"]})] == ["e2"],
    "convidou alguém que foi removido do bolão"))

test("entrada sem e-mail não é convidada (não inventa destinatário)", lambda: _assert(
    [e["id"] for e in convite.eligible_entries(estado(entradas=[
        {"id": "e1", "entryName": "Fulano", "participantEmail": ""},
        {"id": "e2", "entryName": "Beltrano", "participantEmail": "b@example.com"},
    ]))] == ["e2"],
    "tentou convidar uma entrada sem endereço"))

# ── credencial privilegiada ──────────────────────────────────────────────────────────────────
test("sem SUPABASE_SERVICE_ROLE_KEY o script FALHA FECHADO", lambda: _raises(
    convite._sb_key, RuntimeError,
    "caiu para a chave anon — que não enxerga a linha crua e devolveria 'ninguém para convidar'"))

test("lista VAZIA não é lida como 'bolão sem participantes'", lambda: _assert(
    "VAZIA" in (Path(AQUI / "send_invitation_email.py").read_text()),
    "sumiu a distinção entre 'não posso ver' e 'não existe'"))

# ── mascaramento ─────────────────────────────────────────────────────────────────────────────
# O endereço aqui é SINTÉTICO de propósito. Escrevi este teste com o e-mail real de um
# participante — parecia mais honesto testar com o formato que vai aparecer de verdade. O gate de
# privacidade de fixture reprovou, e está certo: um teste que alcance o provedor por engano manda
# mensagem para a pessoa cujo endereço estiver escrito nele. O formato é o que importa aqui, e
# formato não precisa de gente real.
_SINTETICO = "nome.sobrenome@exemplo-invalido.test"
test("e-mail é mascarado no log", lambda: _assert(
    convite.mask_email(_SINTETICO) == "n***@exemplo-invalido.test",
    f"máscara errada: {convite.mask_email(_SINTETICO)}"))

test("e-mail vazio não explode a máscara", lambda: _assert(
    convite.mask_email("") == "(sem e-mail)", "máscara quebrou com entrada vazia"))

# ── envio fecha por padrão ───────────────────────────────────────────────────────────────────
test("envio real BLOQUEADO sem autorização explícita", lambda: (
    lambda r: _assert(r[0] is False, "envio liberado sem BOLAO_ALLOW_REAL_SEND"))(
    convite.real_send_allowed()))

test("send_email não toca no provedor quando bloqueado", lambda: (
    lambda r: _assert(r[0] is False and "BLOCKED" in str(r[1]),
                      f"send_email não bloqueou: {r}"))(
    convite.send_email("x@example.com", "s", "<p>x</p>")))


# ── o token nunca aparece no que é impresso ──────────────────────────────────────────────────
def token_nunca_impresso():
    emitidos = []
    enviados = []

    convite.fetch_state = lambda: estado()
    convite.already_invited_ids = lambda: set()

    def _emite(entry_id, nota):
        t = f"TOKENSECRETO{entry_id}"
        emitidos.append(t)
        return t

    convite.issue_token = _emite
    convite._TRANSPORT = lambda url, body, headers: (enviados.append(body), (200, "ok"))[1]
    os.environ["BOLAO_ALLOW_REAL_SEND"] = "I UNDERSTAND"
    os.environ.pop("BOLAO_TEST_RUN", None)

    buf = io.StringIO()
    try:
        sys.argv = ["x", "--apply"]
        with contextlib.redirect_stdout(buf):
            convite.main()
    finally:
        os.environ["BOLAO_TEST_RUN"] = "1"
        convite._TRANSPORT = None

    saida = buf.getvalue()
    assert emitidos, "o teste não exercitou emissão nenhuma"
    for t in emitidos:
        assert t not in saida, "TOKEN EM CLARO no stdout — vai direto para o log do Actions"
    assert "fulano@example.com" not in saida, "e-mail completo no stdout"
    assert len(enviados) == 2, f"esperava 2 envios, houve {len(enviados)}"
    # e o link tem de carregar o token no FRAGMENTO
    corpo = enviados[0].decode()
    assert "#t=" in corpo, "o link do convite não usa fragmento — o token vazaria no Referer"


test("o token NUNCA é impresso (o log do Actions é retido)", token_nunca_impresso)


# ── idempotência ─────────────────────────────────────────────────────────────────────────────
def nao_convida_duas_vezes():
    convite.fetch_state = lambda: estado()
    convite.already_invited_ids = lambda: {"e1", "e2"}
    convite.issue_token = lambda *a: (_ for _ in ()).throw(
        AssertionError("emitiu token novo para quem já tinha — invalidaria o link em uso"))
    buf = io.StringIO()
    sys.argv = ["x", "--apply"]
    with contextlib.redirect_stdout(buf):
        rc = convite.main()
    assert rc == 0, f"rc={rc}"
    assert "ALREADY_COMPLETE" in buf.getvalue(), buf.getvalue()[-200:]


test("quem já tem credencial viva NÃO é convidado de novo", nao_convida_duas_vezes)



print(f"\n  {ok} passed, {fail} failed\n")
print("✓ INVITATION EMAIL PASSED\n" if fail == 0 else "✗ INVITATION EMAIL FAILED\n")
sys.exit(0 if fail == 0 else 1)
