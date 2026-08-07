/**
 * money.js — formatador USD canônico da plataforma (navegador).
 *
 * DECISÃO DE PRODUTO (Eduardo, 2026-08-07): o formato humano canônico é
 *
 *     US$ X.XX        ex.: US$ 5.00 · US$ 20.00 · US$ 1,250.00
 *
 * "USD tem de ser explicitamente identificável como USD" e a UI não pode usar `US$` enquanto o
 * email do participante usa `$`.
 *
 * Antes desta decisão existiam quatro formatos diferentes em produção para o MESMO tipo de valor:
 *   - `US$5`            (Powerball UI: `"US$" + toLocaleString`, sem casas decimais)
 *   - `$1,250.00`       (email do Powerball: `"$" + 2 casas`)
 *   - `$5`              (Copa: `$${a.toFixed(2).replace(/\.00$/,"")}` — e essa mesma lambda estava
 *                        TRIPLICADA no arquivo)
 *   - `$65`             (pote do CDB2026: interpolação direta)
 *
 * Existem três implementações desta regra, uma por runtime (navegador / Node / Python), porque não
 * há build step neste repo e os três precisam do mesmo resultado. Elas NÃO podem divergir:
 * `bolao/shared/scripts/test_money_interop.mjs` compara as três contra a mesma tabela de valores e
 * falha se qualquer uma sair diferente. Mesmo padrão já usado em notification_repository.mjs/.py.
 *
 * Escopo deliberado: apenas DINHEIRO. Nada aqui toca formatação de DATA — os `toLocaleString` de
 * data espalhados pelos apps são intencionais e ficam como estão.
 */
(function (root) {
  "use strict";

  var CURRENCY_PREFIX = "US$ ";  // com espaço: "US$ 5.00", não "US$5.00"

  /**
   * Arredondamento para centavos EXPLÍCITO e half-up, feito antes de formatar.
   *
   * Por que não deixar cada runtime arredondar sozinho: o teste de interop pegou divergência real
   * em `5.005` — o `Intl` do JS devolvia `5.01` e o `f"{:,.2f}"` do Python devolvia `5.00` (round
   * half-even). Nenhum dos dois defaults é "o certo" para dinheiro; o que importa é a plataforma
   * inteira concordar. `Math.round` em valor POSITIVO já é half-up, e money.py replica com
   * floor(x + 0.5) — por isso sempre arredondamos o valor ABSOLUTO e aplicamos o sinal depois.
   */
  function roundCents(abs) {
    return Math.round(abs * 100) / 100;
  }

  /** Formato canônico: US$ 1,250.00 — sempre 2 casas decimais, separador de milhar en-US. */
  function usd(n) {
    if (n === null || n === undefined || n === "" || !isFinite(Number(n))) return "—";
    var v = Number(n);
    var sign = v < 0 ? "-" : "";
    return sign + CURRENCY_PREFIX + roundCents(Math.abs(v)).toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }

  /**
   * Variante COMPACTA para valores grandes (jackpot): US$ 707M.
   * Continua sendo uma variante deliberada, não uma divergência: mesmo prefixo, mesma origem.
   * Abaixo de 1.000 delega para usd() — um valor pequeno abreviado não ajuda ninguém.
   */
  function usdCompact(n) {
    if (n === null || n === undefined || n === "" || !isFinite(Number(n))) return "—";
    var v = Number(n), abs = Math.abs(v), sign = v < 0 ? "-" : "";
    var value, suffix;
    if (abs >= 1e9) { value = abs / 1e9; suffix = "B"; }
    else if (abs >= 1e6) { value = abs / 1e6; suffix = "M"; }
    else if (abs >= 1e3) { value = abs / 1e3; suffix = "K"; }
    else { return usd(v); }
    var rounded = Math.round(value * 10) / 10;
    var text = rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
    return sign + CURRENCY_PREFIX + text + suffix;
  }

  root.BOLAO_MONEY = { usd: usd, usdCompact: usdCompact, CURRENCY_PREFIX: CURRENCY_PREFIX };
})(typeof window !== "undefined" ? window : globalThis);
