# CDB2026 — ingestão do sorteio oficial da CBF (Batch 3)

**Criado:** 2026-08-07 · **Suíte:** `bolao/cdb2026/scripts/audit_cbf_ingestion.mjs` (23 checks)

A CBF é a **autoridade** sobre o sorteio das quartas. Este documento registra o que foi observado na
fonte oficial e por que o desenho é o que é.

## Caracterização da fonte (observada em 2026-08-07)

| Superfície | Resultado |
|---|---|
| `cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/2026` | **200**, mas 82 KB de casca: zero JSON-LD, zero `__NEXT_DATA__`, nenhum nome de time, nenhuma menção a "quartas". Conteúdo renderizado no cliente. |
| `cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil` | 308 (redireciona) |
| `cbf.com.br/futebol-brasileiro/tabela/...` (singular) | 404 — o caminho real é `tabelas` (plural) |
| `api.cbf.com.br` | não resolve |
| `cms.cbf.com.br/api/menus/1`, `/logo` | **200** — existe um CMS Strapi de verdade |
| `cms.cbf.com.br/api/{campeonatos,competicoes,partidas,jogos,tabelas,confrontos,chaves}` | **todas 404** — nenhuma coleção de competição exposta |

Além disso: **o sorteio das quartas ainda não aconteceu**, então não existe nem um exemplar real de
resposta contra o qual escrever um parser.

## Decisão

Ordem de preferência da instrução: (1) dado estruturado estável da CBF → (2) HTML oficial estável →
(3) ingestão controlada com validação estrita.

(1) não existe hoje: o Strapi está lá, mas sem coleção de competição. (2) não existe: a página não
traz conteúdo no HTML. Escrever um scraper contra uma superfície que não dá para observar seria
fragilidade especulativa só para poder chamar o batch de "automatizado" — o oposto do pedido, que é
**autoridade oficial + auditabilidade + ingestão segura**.

Portanto: **(3) ingestão controlada**, com validação estrita, normalização canônica e proveniência.

## O seam para automação futura

`normalizeCbfDraw()` é **puro** e não sabe de onde os pares vieram. Aceita array de arrays, array de
objetos ou mapa. No dia em que uma superfície estruturada estável da CBF for identificada, o fetcher
automático entrega os pares para **esta mesma função** e todo o contrato de validação/normalização/
hash continua valendo, sem tocar em mais nada. É por isso que a validação **não** vive dentro de um
parser.

## Garantias

- Os 8 classificados são derivados do **resultado das oitavas** (`qualifiedTeamId`), nunca de lista
  digitada. Oitavas incompletas ⇒ ingestão impossível.
- Exatamente 4 confrontos; cada clube classificado aparece **exatamente uma vez**.
- **Ordenação canônica** por par normalizado ⇒ ids determinísticos e `bracketHash` estável. O mesmo
  bracket em formatação/ordem/lados diferentes produz o **mesmo** hash (a identidade do bracket é o
  conjunto de confrontos, não a formatação da fonte).
- Recusa, com código estável, sem nunca "consertar": `DRAW_PARTIAL`, `DRAW_EXTRA_TIES`,
  `TEAM_DUPLICATE`, `TEAM_UNKNOWN`, `TIE_INCOMPLETE`, `TIE_SELF_PAIR`, `SOURCE_MALFORMED`,
  `QUALIFIED_SET_INVALID`, `DRAW_INCOMPLETE_COVERAGE`.
- Autoridade diferente de `CBF` nunca trava o bracket.
- Falha ⇒ **nenhuma** mutação de estado; o torneio permanece em `WAITING_FOR_QUARTERFINAL_DRAW`.
- Re-ingestão idêntica sobre bracket travado ⇒ **no-op**. Diferente ⇒ **recusada**
  (`BRACKET_LOCKED_DIFFERENT`), salvo correção com `reason` **e** `authorizedBy`, que fica
  **registrada** em `officialDraw.correction` junto do `previousBracketHash`.
- A ingestão **não** toca entradas, palpites, pagamentos nem outras fases.
- Nada deriva o bracket da ESPN, de aleatoriedade ou do emparelhamento programático dos
  classificados — coberto por teste de contrato (inclusive a ausência de `Math.random` no app).

## Como registrar o sorteio quando a CBF publicar

Mutação `register-official-draw` com: `pairs` (do que a CBF publicou), `sourceUrl` (a publicação
oficial, que fica guardada como referência da evidência), `scheduledAt`/`publishedAt` quando
conhecidos, e `validatedBy`. Os classificados são derivados do estado automaticamente.

Uma correção posterior exige `correction: { reason, authorizedBy }`.
