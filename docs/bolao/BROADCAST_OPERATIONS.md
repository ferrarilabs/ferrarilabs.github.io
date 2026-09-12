# Modelo operacional — "Onde assistir" (BR2026 / CDB2026)

Issues de origem: [#425](https://github.com/ferrarilabs/ferrarilabs.github.io/issues/425) (modelo
operacional, `CURATED_ONLY`) e [#431](https://github.com/ferrarilabs/ferrarilabs.github.io/issues/431)
(grade de TV, `EPG_CORROBORATED_WITH_CURATED_OVERRIDE`). `#391`/`#392` entregaram a apresentação.

## Modelo atual: `EPG_CORROBORATED_WITH_CURATED_OVERRIDE` (desde a #431)

```
EPGShare BR1/BR2 (XMLTV) → sync_epg_broadcasts.mjs (workflow) → próximos jogos do BR2026
  (snapshot ESPN já commitado) → bolao/shared/data/broadcasts.json → where_to_watch.js (inalterado)
```

> **A emissora de cada partida vem da grade de TV brasileira, só com evidência forte. Curadoria
> humana continua possível como override explícito — e sempre vence — mas deixou de ser necessária
> para cada partida.**

- **Automático:** `.github/workflows/br2026_broadcast_epg.yml` (a cada 3h + `workflow_dispatch`)
  baixa a grade EPGShare BR1/BR2, corrobora contra os jogos do BR2026 dos próximos 7 dias e grava
  `broadcasts.json` só quando o dado muda. Filosofia portada do repositório irmão
  `ferrarilabs/FerrariTV` (`packages/football/src/corroborate.ts`).
- **Também automático (#425):** saber quais partidas ainda não têm cobertura
  (`check_broadcast_coverage.mjs`, agora marcando `[EPG]` ou `[curadoria]`) e recusar arquivo
  corrompido, ambíguo ou conflitante (`validate_broadcasts.mjs`).
- **Continua humano, de propósito:** streaming sem presença na grade (Prime Video, CazéTV só no
  YouTube) e qualquer correção do que a grade disse. Nada disso é inventado pelo pipeline.
- A ESPN identifica a PARTIDA (id, kickoff, clubes). Ela nunca é fonte de transmissão.

### Quando a grade vira transmissão (evidência forte)

Um programa só publica um canal quando **tudo** abaixo vale (`epg_broadcasts.mjs`):

1. cita os **dois** clubes da partida **como confronto** — num mesmo campo (título ou subtítulo), um
   clube de cada lado de um único separador `x`/`×`/`vs` —, com identificação por alias e **sufixo de
   estado como identidade** ("Botafogo-SP" não é Botafogo, "Atlético" sozinho não é Atlético-MG,
   "Campeonato Mineiro" não é Atlético-MG). "Esporte Espetacular: Bahia e Remo" não é jogo;
2. começa entre 60 min antes e 15 min depois do kickoff e continua no ar até pelo menos 45 min depois;
3. não é replay, pré-jogo, feminino, base ou futsal (`VT`, `Pré-Hora`, `Aquecimento`, categoria
   `Futebol Feminino`…) — e um marcador desses em **qualquer** fonte veta o canal naquele horário;
4. as fontes não divergem sobre o que está no ar naquele canal 30 min depois do kickoff;
5. não cita três ou mais clubes, e não corrobora mais de uma partida;
6. o canal está na allowlist.

Um clube só, título genérico ("Futebol", "Programação Globo", "Brasileirão"), identidade ambígua ou
programa fora da janela: **rejeita**. O relatório do workflow diz qual regra barrou cada jogo.

### Canais (allowlist e nome apresentado)

| Na grade | Apresentado |
|---|---|
| `Globo.br`, `…Globo.HD` | Globo (TV aberta — consulte sua região) |
| `Record.TV.br` | Record (TV aberta — consulte sua região) |
| `Band.br` | Band (TV aberta — consulte sua região) |
| `SporTV`, `SporTV 2`, `SporTV 3` | SporTV / SporTV 2 / SporTV 3 |
| `Premiere.Clubes`, `Premiere 2`…`Premiere 9` | Premiere / Premiere N (número preservado) |
| `Band.Sports` | BandSports |
| `ESPN`, `ESPN 2`…`ESPN 6` | ESPN / ESPN N |
| CazéTV | CazéTV (hoje ausente da grade EPGShare) |

TV aberta leva a ressalva regional porque a grade é de uma praça (SP/RJ). GloboNews, Record News,
TNT, Combate e qualquer canal desconhecido nunca viram transmissão. Sufixos de qualidade da
operadora (`HD`, `³`) são descartados.

### Precedência e last-known-good

- **Registro humano** (sem `origin`) nunca é tocado pelo pipeline. Havendo registro humano para a
  partida (por `espnId`, ou minuto + clubes por alias), a evidência automática é descartada e só
  aparece no relatório (`CURATED_OVERRIDE`, "EPG também viu: …"). Curar uma partida que já tinha
  entrada automática substitui a automática no run seguinte.
- **EPG fora do ar** (as duas fontes): o arquivo fica byte-idêntico; o run fica verde com
  `::warning::`.
- **Fonte parcial** ou canal sem programa na grade: a entrada anterior é mantida
  (`KEPT_LAST_KNOWN_GOOD`). "Não sei" nunca vira "não é".
- Um canal automático só sai quando **toda** evidência dele é contraditada no **mesmo `source` e
  mesmo `epgChannelId`**: a fonte respondeu e, 30 min após o kickoff, naquele id está no ar um programa
  real que não é este jogo ao vivo (`REMOVED_CONTRADICTED`). Outra praça da Globo, HD × SD, outra fonte
  discordando, id renomeado e placeholder "Programação …" são "não sei" e mantêm.
- **Adiamento/remarcação:** se o snapshot da ESPN diz que o jogo foi adiado, cancelado ou suspenso, ou
  mudou de horário, a entrada automática antiga sai (`POSTPONED_DROPPED` / `RESCHEDULED_DROPPED`) —
  inclusive com o EPG fora do ar. Canal de outra data é informação errada. Se a grade corroborar o
  novo horário, entra uma entrada nova, só com a evidência nova.
- **Curadoria sem `espnId`:** continua vencendo, mas o BR2026 casa por id e não a exibe. O relatório
  marca `CURATED_OVERRIDE_WITHOUT_ESPNID` e o validador reprova curadoria sem id que colida com uma
  entrada automática da mesma partida. Cure sempre com `espnId`.
- O workflow falha se for disparado fora de `refs/heads/main` e só empurra para `main` explicitamente.
- Entradas automáticas de jogos que passaram há mais de 7 dias são podadas; curadoria nunca.

### Operar o pipeline

```bash
# relatório contra a grade ao vivo, sem gravar
node bolao/shared/scripts/sync_epg_broadcasts.mjs
# reproduzir um run com grade salva em disco e relógio fixo
node bolao/shared/scripts/sync_epg_broadcasts.mjs --epg-dir=/caminho/BR --now=2026-09-12T17:44:00Z --json-report=relatorio.json
# gravar (é o que o workflow faz)
node bolao/shared/scripts/sync_epg_broadcasts.mjs --write
```

No Actions, `workflow_dispatch` tem `dry_run` ligado por padrão. O relatório (fonte por fonte,
partida por partida, com o texto da grade que corroborou ou o motivo da rejeição) aparece no resumo
do run. O autoteste `test_epg_broadcasts.mjs` roda antes; se ele falhar nada é gravado.

## Histórico: `CURATED_ONLY` (#425, 2026-09-07 → #431)

O texto abaixo descreve o modelo anterior. As regras de curadoria continuam valendo para os
registros humanos.

> A descoberta da fonte continua confirmada por humano; a completude da cobertura e a detecção
> operacional são automatizadas.

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
| `origin` | não | ausente/`"curated"` = humano; `"epg"` = gerado pelo pipeline (não editar à mão) |

\* é preciso ter `espnId` OU os três campos de fallback completos — `validate_broadcasts.mjs`
reprova identidade ambígua.

Registros `origin: "epg"` carregam ainda `collectedAt` e `evidence[]`, uma entrada por programa
que corroborou: `channel`, `source` (`epgshare-br1`/`epgshare-br2`), `epgChannelId`,
`programmeTitle`, `programmeSubTitle`, `programmeStart`/`programmeStop` (UTC),
`programmeCategories` (quando a grade tem), `matchedTeams` e `collectedAt`. O validador refaz a
checagem de janela e de allowlist em cima dessa evidência, e reprova canal automático sem
evidência própria ou fora da allowlist (ex.: "Amazon Prime Video" com `origin: "epg"`).

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

## Por que não era automático na #425

Investigado na Issue #425 (a grade de TV não foi avaliada ali — foi a #431 que a adotou): ESPN (schema tem o campo, vem vazio para `bra.1`/`bra.copa_do_brazil`),
API-Football (sem evidência de cobertura de transmissão), API oficial da CBF (não existe
publicamente), scraping de site de emissora (risco legal/manutenção alto, rejeitado
explicitamente) e APIs não-oficiais (instáveis, sem garantia de mercado BR). Nenhuma atende
simultaneamente "match-specific accuracy" + "Brazilian market correctness" + "reliability".

Se isso mudar — em especial se a ESPN passar a publicar `geoBroadcasts` com `region: "br"` — o
ponto de extensão já existe e está documentado no cabeçalho de `where_to_watch.js`: a curadoria
continuaria vencendo, o provedor confiável entraria como fallback, e nenhuma mudança de UI seria
necessária.

## Curated override

Desde a #431 a precedência é real: curadoria vence a grade. Ela é aplicada **na geração do arquivo**
(`mergeBroadcasts()` nunca cria entrada automática para partida com registro humano), e o validador
reprova duas entradas para a mesma partida — então `findBroadcast()` no navegador continua com uma
só resposta por partida e não precisou mudar. Não redesenhar essa ordem sem atualizar este documento.
