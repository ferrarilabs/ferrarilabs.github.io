/**
 * money.mjs — formadador USD canônico da plataforma (Node: emails, receipts, scripts).
 *
 * Espelho EXATO de bolao/shared/js/money.js. Ver o cabeçalho longo lá para a decisão de produto
 * (`US$ X.XX`) e para o histórico dos quatro formatos divergentes que isto substituiu.
 *
 * As duas implementações são comparadas por bolao/shared/scripts/test_money_interop.mjs contra a
 * mesma tabela de valores — divergir faz a suíte falhar.
 */
// "$" nos valores formatados — ver o comentário longo em bolao/shared/js/money.js para a decisão
// e para a divergência DELIBERADA com a prose do i18n.
export const CURRENCY_PREFIX = "$";

// Arredondamento para centavos explícito e half-up — ver o comentário em bolao/shared/js/money.js.
// O teste de interop pegou `5.005` divergindo entre Intl (5.01) e Python (5.00).
function roundCents(abs) {
  return Math.round(abs * 100) / 100;
}

// Centavos aparecem SÓ quando existem de verdade (Eduardo, 2026-08-07: "os centavos continuam
// aparecendo, só deve aparecer no prêmio final"). `$60`, não `$60.00`; mas `$80.50` mantém os centavos.
// O prêmio final é justamente o valor que cai em centavo quebrado (70% do pote), então a regra "some
// com o `.00`" entrega o pedido sem precisar de um formatador especial por contexto.
export function usd(n) {
  if (n === null || n === undefined || n === "" || !isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = v < 0 ? "-" : "";
  const abs = roundCents(Math.abs(v));
  const whole = abs % 1 === 0;
  return sign + CURRENCY_PREFIX + abs.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
  });
}

export function usdCompact(n) {
  if (n === null || n === undefined || n === "" || !isFinite(Number(n))) return "—";
  const v = Number(n), abs = Math.abs(v), sign = v < 0 ? "-" : "";
  let value, suffix;
  if (abs >= 1e9) { value = abs / 1e9; suffix = "B"; }
  else if (abs >= 1e6) { value = abs / 1e6; suffix = "M"; }
  else if (abs >= 1e3) { value = abs / 1e3; suffix = "K"; }
  else { return usd(v); }
  const rounded = Math.round(value * 10) / 10;
  const text = rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
  return sign + CURRENCY_PREFIX + text + suffix;
}
