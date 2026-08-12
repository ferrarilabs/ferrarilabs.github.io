#!/usr/bin/env python3
"""M8/M9 — a ponte tem de GRITAR, e o schema não expõe caminho morto.

O QUE ESTE GATE IMPEDE DE VOLTAR
--------------------------------
Um caminho de auditoria que falha em silêncio é pior que não ter auditoria: passa a impressão de
registro onde não há. O jeito mais fácil de criar um é o mais tentador — `try: registrar() except:
pass`, para "não derrubar o envio por causa de log".

Este repositório já viveu a versão disso que custou caro: `retryable_recipients(...) or esperados`,
onde a lista vazia (falsa em Python) caía para TODOS os destinatários. Um `or` no lugar errado
reenviou e-mail para 15 pessoas. A lição não é sobre `or` — é sobre caminhos de recuperação que
adivinham em vez de recusar.

O QUE É MEDIDO (hermético: lê fonte, não faz rede)
--------------------------------------------------
  1. a ponte levanta sem credencial — e a mensagem diz por quê
  2. `_modo_teste()` exige declaração EXPLÍCITA de teste, nunca ausência de credencial
  3. nenhum `except: pass` em torno de auditoria/outbox
  4. nenhuma chave anon alcança a ponte
  5. os schemas `bolao`/`audit` NÃO são acessados por REST direto (406 garantido; qualquer
     tentativa é caminho morto que vira 404/406 em produção)

Uso: python3 bolao/scripts/test_m8m9_no_silent_fallback.py
"""
import os
import re
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


PONTE = RAIZ / "bolao/shared/scripts/m8m9.py"
LIFECYCLE = RAIZ / "bolao/loterias/powerball/scripts/fetch_and_send_results.py"
CONVITE = RAIZ / "bolao/cdb2026/scripts/send_invitation_email.py"

fonte_ponte = PONTE.read_text()
fonte_life = LIFECYCLE.read_text()
fonte_conv = CONVITE.read_text()


def _codigo(txt):
    """Só linhas executáveis: prosa que cita um símbolo não é uso dele."""
    return "\n".join(l for l in txt.split("\n") if not l.strip().startswith("#"))


def _assert(c, m):
    if not c:
        raise AssertionError(m)


print("\nM8/M9 — sem fallback silencioso\n")

# ── 1. falha fechado ─────────────────────────────────────────────────────────────────────────
def falha_sem_credencial():
    import importlib.util
    spec = importlib.util.spec_from_file_location("m8m9_probe", PONTE)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    antes = os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
    try:
        try:
            m.emit_audit("x.y", "pool")
            raise AssertionError("registrou sem credencial — ou pior, fingiu que registrou")
        except m.M8M9Error as e:
            assert "SUPABASE_SERVICE_ROLE_KEY" in str(e), f"mensagem não explica: {e}"
            assert "anon" in str(e).lower(), (
                "a mensagem não explica a consequência de cair para a anon; sem isso o próximo "
                "leitor 'conserta' adicionando o fallback")
    finally:
        if antes is not None:
            os.environ["SUPABASE_SERVICE_ROLE_KEY"] = antes


test("a ponte LEVANTA sem credencial (não devolve vazio)", falha_sem_credencial)

test("a ponte não conhece a chave anon", lambda: _assert(
    "sb_publishable" not in fonte_ponte and "ANON" not in _codigo(fonte_ponte),
    "a ponte referencia credencial pública — service_role é a ÚNICA concedida nessas funções"))

# ── 2. modo teste é DECLARADO, não deduzido ─────────────────────────────────────────────────
def modo_teste_explicito():
    bloco = fonte_life[fonte_life.index("def _modo_teste"):]
    bloco = bloco[:bloco.index("def _ponte")]
    assert "BOLAO_TEST_RUN" in bloco or "PYTEST_CURRENT_TEST" in bloco, bloco
    assert "SERVICE_ROLE" not in bloco, (
        "modo teste inferido da AUSENCIA de credencial: em produção uma credencial mal "
        "configurada viraria 'estou testando' e a auditoria sumiria em silêncio")


test("modo teste exige declaração explícita, não ausência de credencial", modo_teste_explicito)

# ── 3. nada de except silencioso em torno de auditoria/outbox ───────────────────────────────
def sem_except_mudo():
    for rotulo, fonte in (("lifecycle", fonte_life), ("convite", fonte_conv), ("ponte", fonte_ponte)):
        # `except ...: pass` / `except ...: continue` a menos de 6 linhas de uma chamada da ponte
        linhas = fonte.split("\n")
        for i, l in enumerate(linhas):
            if not re.search(r"\b(emit_audit|emit_outbox|settle|bridge\.)", l):
                continue
            janela = "\n".join(linhas[i:i + 8])
            m = re.search(r"except[^\n]*:\s*\n\s*(pass|continue)\s*$", janela, re.M)
            assert not m, (
                f"[{rotulo}] linha {i + 1}: erro de auditoria/outbox engolido —\n{janela[:220]}")


test("nenhum erro de auditoria/outbox é engolido", sem_except_mudo)

# ── 4. a liquidação relança ─────────────────────────────────────────────────────────────────
def liquidacao_relanca():
    bloco = fonte_life[fonte_life.index("def _liquida_outbox"):]
    bloco = bloco[:bloco.index("def run_lifecycle")]
    assert "raise" in bloco, (
        "_liquida_outbox não relança: o estado do outbox passaria a divergir do ledger sem que "
        "nada apontasse a divergência")


test("falha ao liquidar o outbox é RELANÇADA", liquidacao_relanca)

# ── 5. nenhum acesso REST direto aos schemas não expostos ───────────────────────────────────
def sem_rest_direto():
    for rotulo, fonte in (("lifecycle", fonte_life), ("convite", fonte_conv), ("ponte", fonte_ponte)):
        codigo = _codigo(fonte)
        for tabela in ("rest/v1/outbox_events", "rest/v1/audit_events",
                       "rest/v1/outbox_delivery_attempts"):
            assert tabela not in codigo, (
                f"[{rotulo}] acesso REST direto a {tabela}: os schemas bolao/audit NAO estão "
                "expostos no PostgREST (medido: 406 Invalid schema). Isso é caminho morto — "
                "toda chamada falha, e falhar sempre é como se aprende a ignorar o erro")


test("nenhum acesso REST direto a schema não exposto (sem caminho morto)", sem_rest_direto)

# ── 6. as chaves de negócio são derivadas do estado ─────────────────────────────────────────
def chaves_deterministicas():
    bloco = fonte_ponte[fonte_ponte.index("def key_powerball_result"):]
    for proibido in ("uuid4", "now(", "time.time", "datetime.now"):
        assert proibido not in bloco, (
            f"chave de negócio usa {proibido}: cada execução criaria uma obrigação NOVA para o "
            "mesmo fato, e a recuperação após queda deixaria de funcionar")


test("chaves de negócio são determinísticas (recuperáveis após queda)", chaves_deterministicas)


print(f"\n  {ok} passed, {fail} failed\n")
print("✓ M8M9 NO SILENT FALLBACK PASSED\n" if fail == 0 else "✗ M8M9 NO SILENT FALLBACK FAILED\n")
sys.exit(0 if fail == 0 else 1)
