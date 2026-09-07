# Modelo operacional — "Onde assistir" (BR2026 / CDB2026)

Issue de origem: [#425](https://github.com/ferrarilabs/ferrarilabs.github.io/issues/425).
`#391`/`#392` entregaram a apresentação; este documento é o modelo operacional que faltava.

## O que é automático e o que não é

> **A descoberta da fonte continua confirmada por humano; a completude da cobertura e a
> detecção operacional são automatizadas.**

- **Automático:** saber QUAIS partidas próximas ainda não têm transmissão cadastrada
  (`check_broadcast_coverage.mjs`), e recusar um arquivo de dados corrompido, ambíguo ou
  conflitante antes que ele chegue a produção (`validate_broadcasts.mjs`).
- **Não automático, de propósito:** decidir QUAL é a emissora de uma partida específica. Não
  existe hoje uma fonte confiável, específica por partida e de mercado brasileiro (ver a
  investigação completa na Issue #425 e no cabeçalho de `where_to_watch.js`). Informação errada é
  pior que ausência — por isso a fonte continua sendo curadoria humana com evidência registrada.

## Onde o dado mora

`bolao/shared/data/broadcasts.json` — um objeto com `entries: []`. Cada entrada:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `espnId` | um dos dois* | id do evento na ESPN — chave forte, preferida |
| `kickoffUtc` + `home` + `away` | um dos dois* | fallback quando não há `espnId` (ex.: CDB2026) |
| `channels` | sim | lista não vazia de strings — canal/serviço de streaming |
| `source` | sim | de onde veio a confirmação (URL(s) da(s) fonte(s)) |
| `confirmedAt` | sim | data (YYYY-MM-DD) em que a fonte foi checada |
| `note` | não | contexto adicional (ex.: por que só streaming, cobertura regional) |

\* é preciso ter `espnId` OU os três campos de fallback completos — `validate_broadcasts.mjs`
reprova identidade ambígua.

**Nunca** adicione um registro baseado no direito geral de transmissão da competição — só com
confirmação específica daquela partida. Na dúvida, não publique.

## Como atualizar a cada rodada

1. Rodar o detector de lacunas para ver o que falta:
   ```bash
   node bolao/shared/scripts/check_broadcast_coverage.mjs [--days=21]
   ```
   Ele também roda sozinho em CI (`.github/workflows/br2026_broadcast_coverage.yml`, diário) —
   o log da Action é a evidência; não é preciso lembrar de rodar à mão, só de OLHAR o log quando
   ele apontar `MISSING`.
2. Para cada `MISSING` que já tenha confirmação: adicionar uma entrada em
   `bolao/shared/data/broadcasts.json`, com `source` apontando para a(s) fonte(s) usada(s).
3. Validar antes de commitar:
   ```bash
   node bolao/shared/scripts/validate_broadcasts.mjs
   ```
   Isto também roda como parte de `npm run check` (`test:node`) — um arquivo inválido reprova o
   build antes de chegar a produção.
4. Commit + push. Não precisa bump de cache-bust manual: `where_to_watch.js` (o código) já está
   em `APP_SHARED_FILES`; o dado (`broadcasts.json`) é buscado com `{cache: "no-cache"}` e nunca
   fica preso em cache do navegador — ver o cabeçalho de `where_to_watch.js`.

## Por que não é 100% automático

Investigado na Issue #425: ESPN (schema tem o campo, vem vazio para `bra.1`/`bra.copa_do_brazil`),
API-Football (sem evidência de cobertura de transmissão), API oficial da CBF (não existe
publicamente), scraping de site de emissora (risco legal/manutenção alto, rejeitado
explicitamente) e APIs não-oficiais (instáveis, sem garantia de mercado BR). Nenhuma atende
simultaneamente "match-specific accuracy" + "Brazilian market correctness" + "reliability".

Se isso mudar — em especial se a ESPN passar a publicar `geoBroadcasts` com `region: "br"` — o
ponto de extensão já existe e está documentado no cabeçalho de `where_to_watch.js`: a curadoria
continuaria vencendo, o provedor confiável entraria como fallback, e nenhuma mudança de UI seria
necessária.

## Curated override

A curadoria (`broadcasts.json`) é hoje a ÚNICA fonte, então ela não "vence" ninguém por enquanto —
mas o desenho já reserva essa precedência: se um dia um provedor automatizado for integrado, a
ordem de resolução em `findBroadcast()` deve continuar checando a curadoria PRIMEIRO, o provedor
DEPOIS, e "nada" por último. Isso é o que já está descrito no cabeçalho do módulo como o ponto de
revisão único — não redesenhar essa ordem sem atualizar este documento.
