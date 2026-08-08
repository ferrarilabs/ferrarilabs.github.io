"""money.py — formatador USD canônico da plataforma (Python: emails de resultado, scripts).

Espelho EXATO de bolao/shared/js/money.js e bolao/shared/scripts/money.mjs. Ver o cabeçalho longo
do arquivo .js para a decisão de produto (`US$ X.XX`) e para os quatro formatos divergentes que isto
substituiu.

As três implementações são comparadas por bolao/shared/scripts/test_money_interop.mjs (que executa
este módulo via python3) contra a mesma tabela de valores — divergir faz a suíte falhar.
"""

# "$" nos valores formatados — ver bolao/shared/js/money.js para a decisão e para a divergência
# DELIBERADA com a prose do i18n.
CURRENCY_PREFIX = "$"


def _round_cents(a):
    """Arredonda um valor ABSOLUTO para centavos com half-up.

    O `round()` do Python é half-even e o `f"{:,.2f}"` idem, enquanto o `Intl` do JS arredonda
    half-up — o teste de interop pegou isso em 5.005 (Python 5.00 vs JS 5.01). Para dinheiro o que
    importa é os três runtimes concordarem, então o arredondamento fica EXPLÍCITO aqui em vez de
    herdado do default de cada linguagem. `math.floor(x + 0.5)` reproduz o `Math.round` do JS para
    valor positivo, que é a razão de só receber valor absoluto.
    """
    import math
    return math.floor(a * 100 + 0.5) / 100


def usd(n):
    """US$ 1,250.00 — sempre 2 casas, separador de milhar en-US."""
    if n is None or n == "":
        return "—"
    try:
        v = float(n)
    except (TypeError, ValueError):
        return "—"
    if v != v or v in (float("inf"), float("-inf")):  # NaN/inf
        return "—"
    sign = "-" if v < 0 else ""
    a = _round_cents(abs(v))
    # Centavos aparecem SÓ quando existem de verdade (Eduardo, 2026-08-07: "os centavos continuam
    # aparecendo, só deve aparecer no prêmio final"). `$60`, não `$60.00`; mas `$80.50` mantém os centavos.
    # O prêmio final é justamente o valor que cai em centavo quebrado (70% do pote), então a regra "some
    # com o `.00`" entrega o pedido sem precisar de um formatador especial por contexto.
    return f"{sign}{CURRENCY_PREFIX}{a:,.0f}" if a == int(a) else f"{sign}{CURRENCY_PREFIX}{a:,.2f}"


def usd_compact(n):
    """US$ 707M — variante compacta para jackpot. Abaixo de 1.000 delega para usd()."""
    if n is None or n == "":
        return "—"
    try:
        v = float(n)
    except (TypeError, ValueError):
        return "—"
    if v != v or v in (float("inf"), float("-inf")):
        return "—"
    a = abs(v)
    sign = "-" if v < 0 else ""
    if a >= 1e9:
        value, suffix = a / 1e9, "B"
    elif a >= 1e6:
        value, suffix = a / 1e6, "M"
    elif a >= 1e3:
        value, suffix = a / 1e3, "K"
    else:
        return usd(v)
    # Mesmo half-up explícito do usd(): o round() do Python é half-even e divergia do
    # Math.round do JS em valores como 1250 (12.5 -> 12 no Python, 13 no JS).
    import math
    rounded = math.floor(value * 10 + 0.5) / 10
    text = f"{rounded:.0f}" if rounded == int(rounded) else f"{rounded:.1f}"
    return f"{sign}{CURRENCY_PREFIX}{text}{suffix}"
