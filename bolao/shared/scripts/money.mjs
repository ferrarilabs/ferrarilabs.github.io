/**
 * money.mjs — formadador USD canônico da plataforma (Node: emails, receipts, scripts).
 *
 * Espelho EXATO de bolao/shared/js/money.js. Ver o cabeçalho longo lá para a decisão de produto
 * (`US$ X.XX`) e para o histórico dos quatro formatos divergentes que isto substituiu.
 *
 * As duas implementações são comparadas por bolao/shared/scripts/test_money_interop.mjs contra a
 * mesma tabela de valores — divergir faz a suíte falhar.
 */
export const CURRENCY_PREFIX = "US$ ";

// Arredondamento para centavos explícito e half-up — ver o comentário em bolao/shared/js/money.js.
// O teste de interop pegou `5.005` divergindo entre Intl (5.01) e Python (5.00).
function roundCents(abs) {
  return Math.round(abs * 100) / 100;
}

export function usd(n) {
  if (n === null || n === undefined || n === "" || !isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = v < 0 ? "-" : "";
  return sign + CURRENCY_PREFIX + roundCents(Math.abs(v)).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
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
