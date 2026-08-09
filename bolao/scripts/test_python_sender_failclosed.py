#!/usr/bin/env python3
"""
CONTRATO FAIL-CLOSED DOS SENDERS PYTHON — exercitado, não afirmado.

POR QUE: a auditoria de 2026-08-09 (AUD-02) encontrou os senders de e-mail do futebol sem
NENHUMA trava. Bastava executar o script — num teste, numa máquina local, por engano — para o
provedor ser chamado de verdade. O sender do Powerball já tinha proteção; ela nunca foi propagada.

Neste repositório o risco não é hipotético: um envio errado já saiu para 15 pessoas reais.

O gate estático (`scripts/audit_email_send_safety.mjs`) garante que a trava EXISTE no código.
Este arquivo garante que ela FUNCIONA — importa cada sender de verdade e tenta enviar.

NENHUM ENDEREÇO REAL. Só domínios reservados por RFC 2606.

Uso: python3 bolao/scripts/test_python_sender_failclosed.py
"""

import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SENDERS = [
    ("br2026", ROOT / "bolao/br2026/scripts/send_round_email.py"),
    ("cdb2026", ROOT / "bolao/cdb2026/scripts/send_result_email.py"),
    ("copa2026", ROOT / "bolao/copa2026/scripts/send_result_email.py"),
    ("copa2026-bracket", ROOT / "bolao/copa2026/scripts/send_bracket_correction_email.py"),
]

RESERVED = "destinatario@example.invalid"

passed = failed = 0


def check(name, fn):
    global passed, failed
    try:
        fn()
        print(f"  ✓ {name}")
        passed += 1
    except Exception as e:  # noqa: BLE001 — o objetivo é reportar, não propagar
        print(f"  ✗ {name}\n      {e}")
        failed += 1


def load(path):
    """Importa o sender isoladamente, sem executar o main() dele."""
    spec = importlib.util.spec_from_file_location(f"sender_{path.stem}_{id(path)}", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def call_send(mod, **kw):
    """Chama send_email com a assinatura que o sender tiver (algumas têm subject, outras não)."""
    import inspect

    sig = inspect.signature(mod.send_email)
    args = {"addr": RESERVED, "html": "<p>fixture</p>"}
    if "subject" in sig.parameters:
        args["subject"] = "fixture"
    args.update(kw)
    return mod.send_email(**{k: v for k, v in args.items() if k in sig.parameters})


print("\nContrato fail-closed dos senders Python\n")

for label, path in SENDERS:
    if not path.exists():
        check(f"[{label}] arquivo existe", lambda: (_ for _ in ()).throw(AssertionError(f"não achei {path}")))
        continue

    # ── 1. contexto de TESTE + transporte real → recusa ANTES da rede ───────────────────────
    def caso_teste(path=path, label=label):
        os.environ["BOLAO_TEST_RUN"] = "1"
        os.environ.pop("BOLAO_ALLOW_REAL_SEND", None)
        mod = load(path)
        mod._TRANSPORT = None
        # Se a trava falhar, isto tentaria alcançar api.emailjs.com de verdade. É exatamente o
        # que o teste precisa provar que NÃO acontece — por isso o transporte fica None.
        out = mod.send_email.__wrapped__(RESERVED) if hasattr(mod.send_email, "__wrapped__") else call_send(mod)
        assert isinstance(out, tuple) and out[0] is False, f"não recusou: {out!r}"
        assert "EMAIL_SEND_BLOCKED" in str(out[1]), f"motivo não é legível por máquina: {out[1]!r}"

    check(f"[{label}] contexto de TESTE + transporte real → RECUSA antes da rede", caso_teste)

    # ── 2. sem autorização (nem teste declarado) → recusa ───────────────────────────────────
    def caso_sem_auth(path=path):
        os.environ.pop("BOLAO_TEST_RUN", None)
        os.environ.pop("PYTEST_CURRENT_TEST", None)
        os.environ.pop("BOLAO_ALLOW_REAL_SEND", None)
        mod = load(path)
        mod._TRANSPORT = None
        out = call_send(mod)
        assert isinstance(out, tuple) and out[0] is False, f"enviou sem autorização: {out!r}"

    check(f"[{label}] execução comum SEM autorização → RECUSA (padrão é não enviar)", caso_sem_auth)

    # ── 3. transporte injetado → lógica roda inteira, sem rede ──────────────────────────────
    def caso_transporte(path=path):
        os.environ["BOLAO_TEST_RUN"] = "1"
        mod = load(path)
        chamadas = []

        def fake(url, body, headers):
            chamadas.append(url)
            return 200

        mod._TRANSPORT = fake
        out = call_send(mod)
        assert chamadas, "o transporte injetado não foi usado — a lógica de envio não foi exercitada"
        assert "emailjs" in chamadas[0], f"URL inesperada: {chamadas[0]}"
        assert out == 200 or out is True or (isinstance(out, tuple) and out[0]), f"retorno inesperado: {out!r}"

    check(f"[{label}] transporte INJETADO → lógica completa roda sem tocar na rede", caso_transporte)

    # ── 4. autorização explícita + transporte falso → caminho de produção liberado ──────────
    def caso_autorizado(path=path):
        os.environ.pop("BOLAO_TEST_RUN", None)
        os.environ.pop("PYTEST_CURRENT_TEST", None)
        os.environ["BOLAO_ALLOW_REAL_SEND"] = "I UNDERSTAND"
        mod = load(path)
        chamadas = []
        mod._TRANSPORT = lambda url, body, headers: (chamadas.append(url), 200)[1]
        out = call_send(mod)
        assert chamadas, "com autorização explícita o caminho de envio deveria rodar"
        os.environ.pop("BOLAO_ALLOW_REAL_SEND", None)

    check(f"[{label}] autorização EXPLÍCITA → caminho de produção liberado", caso_autorizado)

# ── 5. a autorização de produção não vaza para o ambiente por padrão ────────────────────────
def sem_vazamento():
    assert os.environ.get("BOLAO_ALLOW_REAL_SEND") is None, (
        "a variável de autorização ficou setada no ambiente depois dos testes — "
        "um script executado em seguida enviaria de verdade"
    )

check("a autorização não vaza para o ambiente depois dos testes", sem_vazamento)

print(f"\n  {passed} passed, {failed} failed")
if failed:
    print("\n✗ PYTHON SENDER FAIL-CLOSED FAILED\n")
    sys.exit(1)
print("\n✓ ALL CHECKS PASSED\n")
