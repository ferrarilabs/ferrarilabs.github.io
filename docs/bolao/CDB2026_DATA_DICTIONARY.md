# CDB2026 — Data Dictionary

**Escopo:** formato do objeto de estado persistido (`localStorage["bolao_cdb2026_state"]` e
coluna `bolao_state.state jsonb`, linha `id = "cdb2026"`).
**Gerado:** 2026-08, Fase 2, item 16 (§9 do mega-prompt).
**Fonte:** leitura direta de `emptyState()` (`app.js:66-75`), `fixtures/golden_state.json`
(fixture anonimizada verificada contra o motor real), e todos os pontos de leitura/escrita de
cada campo encontrados no arquivo.

## Raiz do estado

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `entries` | `Entry[]` | sim (default `[]`) | Uma entrada por palpite submetido |
| `deletedIds` | `string[]` | sim (default `[]`) | Tombstones — ids removidos que NUNCA devem ressuscitar via merge |
| `paid` | `{[entryId]: boolean}` | sim (default `{}`) | Marca de pagamento admin, any-true-wins no merge (ver `ADR-002`) |
| `phases` | `{[phaseId]: Phase}` | sim | Estado de cada fase do torneio (confrontos, cutoff) |
| `espnSync` | `EspnSyncState` | sim | Flags de sincronização automática com a ESPN |
| `auditLog` | `AuditEvent[]` | sim (default `[]`) | Trilha de ações admin — ver `ADR-004` sobre suas limitações |
| `meta` | `{updatedAt, version}` | sim | Carimbo de quando/qual versão do site salvou por último |

## `Entry` (uma entrada de participante)

| Campo | Tipo | Fonte | Notas |
|---|---|---|---|
| `id` | `string` (uuid) | `uuid()`, `app.js:442` | Chave primária lógica dentro do array |
| `entryName` | `string` | formulário | Nome da ENTRADA (pode haver múltiplas por participante — ex. "REDACTED_PARTICIPANT #1"/"#2", ver `CHANGELOG` 2026-08-01) |
| `payerName` | `string` | formulário | Nome de quem pagou (pode diferir do participante) |
| `participantEmail` | `string` | formulário | Único campo de contato — recibo e busca de entrada usam este e-mail |
| `paymentMethod` | `"CashApp"\|"Zelle"\|"Venmo"` | formulário | Chave em `C.paymentMethods`/`C.paymentLinks` |
| `picks` | `{matches, qualified}` | formulário | Ver `Picks` abaixo |
| `createdAt` | `ISO 8601 string, UTC` | `new Date().toISOString()` | Nunca reescrito após criação |
| `updatedAt` | `ISO 8601 string, UTC` | só presente se editada | Usado por `mergeStates()` para decidir qual versão é mais nova em conflito |

### `Picks`

| Campo | Tipo | Descrição |
|---|---|---|
| `matches` | `{[tieId]: {first?, second?, single?}}` | Palpite de placar por perna — `{goalsHome, goalsAway}` cada |
| `qualified` | `{[tieId]: "A"\|"B"}` | Palpite de quem avança — `"A"` = `tie.teamA`, `"B"` = `tie.teamB` |

**Nota de orientação (AUDIT-05):** `goalsHome`/`goalsAway` no palpite de uma perna "second" (TWO_LEG) são relativos ao mandante DAQUELA perna (que é `teamB`, não `teamA` — mandante se inverte na volta). Ver `legTeams()`, `app.js:479`.

## `Phase`

| Campo | Tipo | Descrição |
|---|---|---|
| `cutoffAt` | `ISO 8601 string, UTC \| null` | Cutoff manual desta fase — só usado se `effectivePhaseCutoffMs()` não achar um kickoff real conhecido (ver `firstKnownKickoffMs`) |
| `ties` | `{[tieId]: Tie}` | Confrontos desta fase |

## `Tie` (um confronto)

| Campo | Tipo | Descrição |
|---|---|---|
| `teamA` / `teamB` | `string` | Nomes dos dois times — `teamA` é sempre o mandante nominal da "ida"/"single" |
| `qualifiedTeamId` | `"A"\|"B"` \| ausente | Só existe quando o resultado é OFICIAL (ver `ADR-003`) — ausência = ainda não resolvido |
| `matches` | `{first?, second?, single?}` | Uma `Match` por perna, conforme `legsForFormat(phase.format)` |

`phase.format` (de `DATA.phases`, não do estado) determina as pernas: `"TWO_LEG"` → `first`+`second`; qualquer outro valor → `single`.

## `Match` (uma partida/perna)

| Campo | Tipo | Descrição |
|---|---|---|
| `homeTeam` / `awayTeam` | `string \| null` | Explícito quando a ESPN grava (pode ter mandante diferente do posicional em casos raros) — `legTeams()` cai para o posicional (`teamA`/`teamB`) se ausente |
| `kickoff` | `ISO 8601 string, UTC \| null` | Horário do jogo — exibido em dual ET+BRT (`fmtDate()`) |
| `venue` / `city` | `string \| null` | Só decorativo, de `fetchEspnCandidates()` |
| `goalsHome` / `goalsAway` | `int \| null` | Placar OFICIAL — `null` até ser gravado (admin ou auto-sync ESPN) |
| `status` | `"SCHEDULED"\|"FINAL"` | `"FINAL"` é o que `scoreEntry()` exige para pontuar essa perna |

## `EspnSyncState`

| Campo | Tipo | Descrição |
|---|---|---|
| `activePhaseId` | `string \| null` | Fase que a sincronização automática está observando agora |
| `seededKnownConfrontos` | `boolean` | Flag "rodou uma vez" — ver `ESPN_SYNC_ONCE_FLAGS`, `app.js:242` |
| `backfilledOitavasKickoffs` | `boolean` | idem |
| `healedFalseAutoResults` | `boolean` | idem |
| `healedPhantomTies` | `boolean` | idem |

Todas as 4 flags booleanas são "any-true-wins" no merge (AUDIT-01) — uma vez `true` em qualquer
dispositivo, permanece `true` para sempre, porque a rotina que cada uma guarda é destrutiva se
rodar duas vezes (ex.: recriar confrontos já existentes).

## `AuditEvent`

| Campo | Tipo | Descrição |
|---|---|---|
| `action` | `string` | Chave curta (`"toggle-paid"`, `"delete-entry"`, `"save-leg"`, `"lock-tie"`, `"unlock-tie"`, `"edit-leg"`) — usada para montar a chave i18n `auditAction_<snake_case>` |
| `ts` | `ISO 8601 string, UTC` | Quando o evento ocorreu |
| `detail` | `object` | Forma varia por `action` — sempre inclui os campos suficientes para reconstruir antes/depois (ex. `toggle-paid`: `{entryId, entryName, from, to}`) |

Ver `ADR-004` para as limitações deste log como trilha de auditoria.

## Constantes de configuração relevantes (não fazem parte do estado, mas são lidas junto)

| Campo (`config.js`) | Usado por | Nota |
|---|---|---|
| `scoring.match.{exact,result,side}` | `matchPoints()` | 10/5/1 — nunca alterar sem autorização |
| `scoring.tieBonus` | `scoreEntry()` | 5 |
| `scoring.bonus.{champion,runnerUp}` | `scoreEntry()` | 30/20 |
| `database.{url,anonKey,table,stateId}` | `saveRemoteState()`/`loadRemoteState()` | `stateId = "cdb2026"` |
| `espn.scoreboardUrl` | `fetchEspnCandidates()` | endpoint público da ESPN, sem chave |
| `emailjs.{serviceId,participantTemplateId,adminTemplateId,publicKey,limitRateMs}` | `sendReceipt()`/`queueReceipt()` | ver `CDB2026_MODERNIZATION_REPORT_2026-08.md` §6 sobre os limites da fila |

## Confirmado NÃO existir neste modelo de dados (relevante para `audit_integrity.py`)

- Nenhum registro de participante separado das entradas (o participante É a entrada — ver nota
  em `CDB2026_CODE_INVENTORY.md`).
- Nenhuma pontuação ou ranking persistidos — sempre recalculados ao vivo por `scoreEntry()`/
  `rankEntriesBy()` a partir de `entries`+`phases`.
- Nenhum número de revisão/versão por gravação (ver `ADR-002`).
