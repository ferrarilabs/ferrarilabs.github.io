# CDB2026 — Regras e Modelo Oficial

**Status: APROVADO por Eduardo em 2026-07-13 (4 perguntas de confirmação respondidas via
AskUserQuestion) — implementação autorizada.** Este arquivo é a fonte oficial do modelo do
CDB2026 a partir de agora, referenciada por `CLAUDE.md` e pelas demais docs de plataforma.

**Decisões confirmadas:**
- Não existem entradas reais hoje (`database.enabled: false`, app nunca publicado) → migração é
  reescrita limpa, sem conversão de dado antigo (seção 4.2).
- Bônus de campeão/vice **mantido em 30/20** (valor atual do `config.js`), não muda para 25/15.
- A 1ª Fase (126 clubes) tem confrontos reais conhecidos, mas **não serão hardcoded em
  `data.js`** — o admin cadastra os confrontos de qualquer fase (incluindo a 1ª) através de uma
  tela de admin nova, dentro do próprio app. Isso resolve a dependência de eu precisar da lista
  real de confrontos antes de implementar, e também testa o fluxo "nova fase" desde o primeiro
  uso real do sistema.
- Entry fee (US$5) e divisão de prêmio (70/20/10) **sem mudança**.

Fonte de negócio: Regulamento Específico da Copa do Brasil 2026, resumido por Eduardo em
2026-07-13. Este documento — quando aprovado — passa a ser a fonte oficial do modelo do
CDB2026, referenciada por `CLAUDE.md` e pelas outras docs de plataforma.

---

## 1. Auditoria — como o CDB2026 funciona HOJE

Versão auditada: `v2.9` (última versão mergeada em `main`, commit `31f24d2`). Único app
auditado nesta rodada — `bolao/` (Copa do Mundo) e `bolao/br2026/` (Brasileirão) **não foram
tocados nem precisam ser**, o problema é específico do modelo de dados do CDB2026.

Respostas às 12 perguntas obrigatórias:

1. **Como o CDB2026 funciona hoje?** Mata-mata de 16 clubes fixos, 4 fases (Oitavas → Quartas
   → Semifinal → Final), todas as fases exceto a Final em ida+volta com placar agregado. É uma
   cópia estrutural do bracket de mata-mata da Copa do Mundo (`resolveBracket`/`fromHome`/
   `fromAway`/`Winner Match N`-equivalente), adaptada para ter 2 pernas por confronto em vez de
   1 partida.
2. **Ele está usando bracket fixo?** Sim — `bolao/cdb2026/js/data.js`, `DATA.ties` é um array
   fixo de 15 confrontos (8+4+2+1) com IDs fixos (`oitavas-1`...`final-1`) e relações
   `fromHome`/`fromAway` hardcoded. As fases além das Oitavas já têm `id`/`round`/`order`
   definidos no código mesmo sem o sorteio real ter acontecido — os placeholders só faltam
   `home`/`away`/data/estádio, mas a **existência e o formato do confronto (2 pernas, exceto a
   final)** já está fixado no código, não é descoberto dinamicamente.
3. **Ele distingue partida de confronto?** Parcialmente, e só para exibição — `DATA.ties[].leg2`
   guarda data/estádio de cada perna separadamente na aba "Jogos", mas o **placar não é por
   partida**: tanto o palpite do participante (`entry.picks.ties[tieId] = {goalsA, goalsB,
   advance}`) quanto o resultado oficial (`s.results.ties[tieId]`) e o placar por perna recém
   adicionado em v2.9 (`s.results.legs[tieId].leg1/.leg2`) tratam o confronto como a unidade de
   dado — não existe uma entidade "partida" com `id` próprio, times, data e placar individuais
   que scoring e picks referenciem.
4. **Ele suporta ida e volta?** Estruturalmente sim para Oitavas→Semifinal (2 pernas por
   confronto), mas **o participante nunca palpita cada jogo separadamente** — ele digita
   diretamente um "placar agregado" como se fosse um placar único (`tie-inputs`: `goalsA`/
   `goalsB` para o CONFRONTO inteiro, não para cada perna). Só o admin, desde v2.9, informa o
   placar de cada perna — o participante continua sem essa opção.
5. **Ele calcula agregado automaticamente?** Do lado do admin, sim (desde v2.9 — soma leg1+leg2
   automaticamente ao travar). Do lado do participante, **não** — o agregado é o próprio campo
   que ele digita diretamente, não é calculado a partir de um palpite de ida + um palpite de
   volta.
6. **Ele armazena classificado separadamente?** Sim, `advance: "home"|"away"` é um campo
   distinto do placar dentro do mesmo objeto (`{goalsA, goalsB, advance}`), tanto no palpite
   quanto no resultado oficial. Essa parte já está no formato certo conceitualmente.
7. **Ele trata pênaltis corretamente?** Sim — `inferAdvance()` (usada tanto no palpite quanto,
   via padrão equivalente, no admin) trava `advance` automaticamente quando o agregado não
   empata (não há o que escolher) e libera escolha manual só quando empata (pênaltis =
   imprevisível). Pênaltis nunca entram no placar armazenado. **Esta parte da lógica de negócio
   já está correta e pode ser reaproveitada no modelo novo.**
8. **Ele aguarda sorteios?** Não — todas as 15 vagas do bracket (incluindo Quartas, Semifinal,
   Final) já existem como registros fixos em `data.js` desde a criação do arquivo, com
   `fromHome`/`fromAway` apontando para os confrontos anteriores. Isso pressupõe implicitamente
   um chaveamento eliminatório direto (vencedor de A enfrenta vencedor de B, sempre a mesma
   dupla), que é como funciona o mata-mata da Copa do Mundo, mas **a Copa do Brasil sorteia os
   confrontos de cada fase** — o `data.js` atual não tem nenhum mecanismo para representar "essa
   fase ainda não tem confrontos definidos, aguardando sorteio", só o estado "times ainda não
   resolvidos, mas a estrutura de chaveamento já é fixa".
9. **Ele possui cutoff por fase?** Não — existe só **um cutoff global único**
   (`config.cutoffIso: "2026-08-01T12:00:00-03:00"`, comentário no código já desatualizado:
   "cutoff before quarterfinal second leg", claramente um resquício de uma versão anterior do
   plano). Cada confronto individual tem seu próprio `cutoffIso` (1h antes do jogo de ida), mas
   isso é por **confronto**, não por **fase inteira** — não há um conceito de "a fase X abre/
   fecha para todo mundo nesse horário".
10. **Quais dados atuais seriam incompatíveis?** Ver seção 3 (Plano de Migração) — resumo:
    tamanho do bracket (16 times/15 confrontos fixos vs. 126 clubes/9 fases dinâmicas), formato
    fixo por fase (hoje: ida+volta em tudo exceto a final; correto: 1ª–4ª fases partida única,
    5ª–8ª+semi ida+volta, 9ª final única), e o "placar agregado direto" no palpite do
    participante (deveria ser derivado de palpites por partida, nunca digitado diretamente).
11. **Existem entradas reais?** Não verificável neste sandbox (sem acesso à internet/Supabase),
    mas a evidência circunstancial é forte de que **não**: `database.enabled: false` no
    `config.js` (nenhum Supabase ativo, single source seria o `localStorage` de cada navegador
    individual), o app **nunca foi publicado** (sem link a partir do site principal, confirmado
    em `docs/bolao/PLATFORM_GOVERNANCE.md` e em todas as versões do `CHANGELOG.md` até a v2.9),
    e o `CHANGELOG.md` não registra nenhum ciclo de "entrada real recebida" como os outros dois
    apps registram. **Eduardo deve confirmar isso antes de qualquer implementação** — se por
    acaso alguém já testou e salvou uma entrada localmente (só no próprio navegador, sem
    Supabase), ela existe apenas naquele dispositivo específico e não seria afetada por uma
    migração no repositório (o dado já salvo no `localStorage` de terceiros não é tocado por um
    deploy de código).
12. **Qual o risco de migração?** **Baixo**, condicionado à resposta da pergunta 11. Sem
    Supabase ativo e sem publicação, o "estado" hoje é, na pior hipótese, dado de teste em
    navegadores individuais (incluindo o do próprio Eduardo) — não há uma base de dados
    centralizada para migrar. Ainda assim, o plano de migração (seção 3) trata o caso de forma
    conservadora, sem apagar nada silenciosamente.

---

## 2. Findings

| # | Severidade | Achado | Evidência |
|---|---|---|---|
| F1 | 🔴 Critical | Bracket inteiro (16 times, 15 confrontos, todas as fases) é fixo no código desde a criação do app, incompatível com uma competição de 126 clubes/9 fases com sorteios progressivos | `bolao/cdb2026/js/data.js` inteiro |
| F2 | 🔴 Critical | Formato por fase é fixo (ida+volta em tudo exceto final) em vez de derivado da fase real (1ª–4ª única, 5ª–8ª+semi ida+volta, final única) | `DATA.ties` não tem campo `format`; toda fase que não é `"final"` sempre renderiza 2 pernas |
| F3 | 🟠 High | Participante nunca palpita partida por partida — digita o agregado diretamente como se fosse um placar único, mesmo em confrontos de ida+volta | `renderPickForm()`/`tie-inputs`, `bolao/cdb2026/js/app.js` |
| F4 | 🟠 High | Não há conceito de "fase aguardando sorteio" — a UI mostra "Aguardando definição dos times (fase anterior ainda não terminou)" mesmo quando na vida real a causa seria "sorteio ainda não ocorreu", uma situação diferente que a UI atual não descreve corretamente | `pickWaitingSlot` i18n key, usada indiscriminadamente |
| F5 | 🟡 Medium | Cutoff é global (um só, para o app inteiro) — deveria ser por fase, já que cada fase da Copa do Brasil tem sua própria janela de tempo real | `config.cutoffIso` único |
| F6 | 🟡 Medium | Comentário do cutoff está desatualizado ("cutoff before quarterfinal second leg") — não bate com o comportamento real do código (cutoff antes das Oitavas) | `bolao/cdb2026/js/config.js:11` |
| F7 | 🟡 Medium | Regras/transparência não explicam a diferença entre partida/confronto/agregado, nem a regra "sem gol fora de casa", nem tratamento de pênaltis, nem cutoff por fase — usuário leigo não teria como entender o sistema atual, e menos ainda o proposto | `renderRules()` |
| F8 | 🟢 Low | Bug de i18n: chave `errorAdvanceRequired` duplicada no objeto de idioma — a segunda definição (contexto admin, adicionada na v2.9) sobrescreve silenciosamente a primeira (contexto de palpite do participante), fazendo a mensagem de erro do formulário de palpite mostrar o texto errado (fala de "pênaltis"/"travar" em vez de "selecione quem avança") | `bolao/cdb2026/js/i18n.js`, chave `errorAdvanceRequired` aparece 2x no mesmo objeto `pt-BR` — **encontrado e corrigido localmente durante esta sessão, revertido sem commit para não misturar com esta auditoria; deve ser corrigido junto da migração, não separadamente** |
| F9 | 🟢 Low | `bolao/cdb2026/js/app.js` tinha (antes de eu reverter as mudanças não commitadas desta sessão) um mecanismo de pódio via 4 dropdowns diretos e desconectados dos palpites de confronto — já identificado como incorreto por Eduardo antes desta mensagem; **superado pelo modelo novo desta proposta**, não precisa de correção isolada | Ver changelog `v1.0`/`v2.0` |

Nenhum finding toca `bolao/` (Copa) ou `bolao/br2026/` (Brasileirão) — confirmado por escopo de
arquivo (só `bolao/cdb2026/*` foi lido/auditado) e por arquitetura (os três apps não
compartilham código, ver `docs/bolao/PLATFORM_GOVERNANCE.md`).

---

## 3. Modelo Proposto

### 3.1 Entidades

```
competition
├── tournamentId: "cdb2026"
├── currentPhaseId: string | null   // fase ativa para palpite; null = nenhuma fase aberta
└── phases: Phase[]

Phase
├── id: string                       // ex.: "fase-1", "oitavas", "semifinal"
├── name: string                     // ex.: "1ª Fase", "Oitavas de Final"
├── format: "SINGLE_MATCH" | "TWO_LEG"
├── status: "WAITING_DRAW" | "OPEN" | "LOCKED" | "IN_PROGRESS" | "COMPLETE"
├── cutoffAt: string (ISO) | null    // null enquanto WAITING_DRAW
└── ties: Tie[]

Tie (confronto)
├── id: string
├── phaseId: string
├── teamA: string | null             // null até o sorteio
├── teamB: string | null
├── firstLegMatchId: string | null
├── secondLegMatchId: string | null  // null se format = SINGLE_MATCH
├── qualifiedTeamId: string | null   // preenchido só quando classificado é oficial
└── status: "WAITING_DRAW" | "WAITING_TEAMS" | "OPEN" | "IN_PROGRESS" | "COMPLETE"

Match (partida)
├── id: string
├── tieId: string
├── leg: "SINGLE" | "FIRST" | "SECOND"
├── homeTeam: string
├── awayTeam: string
├── kickoff: string (ISO) | null
├── venue: string | null
├── goalsHome: number | null
├── goalsAway: number | null
└── status: "SCHEDULED" | "POSTPONED" | "CANCELED" | "FINAL"

ParticipantPick
├── entryId: string
├── matchPredictions: { [matchId]: { goalsHome: number, goalsAway: number } }
├── qualifiedPredictions: { [tieId]: teamId }   // obrigatório só se o agregado previsto empatar
├── championPick: teamId | null       // só relevante na fase final
├── ruleVersion: string               // qual versão deste modelo valia quando a entrada foi salva
├── createdAt: string
└── updatedAt: string
```

### 3.2 Diferenças-chave vs. o modelo atual

| Aspecto | Hoje (errado) | Proposto |
|---|---|---|
| Bracket | Fixo, 15 confrontos definidos no código desde o início | Fases carregadas incrementalmente; uma fase sem confrontos sorteados mostra "Aguardando sorteio oficial", não um placeholder de bracket |
| Formato por fase | Sempre ida+volta exceto final | Campo `format` explícito por fase (`SINGLE_MATCH` 1ª–4ª e final; `TWO_LEG` 5ª–8ª+semi) |
| Unidade de palpite | Agregado digitado diretamente | Placar de cada partida (`Match`) palpitado individualmente; agregado é sempre **calculado**, nunca digitado |
| Pênaltis | Já corretos (não entram no placar) | Mantido — nenhuma mudança de comportamento aqui, só de onde o dado mora |
| Cutoff | Um único, global | Um `cutoffAt` por fase |
| 3º/4º lugar | N/A (já não existe) | Confirmado: **não existe** na Copa do Brasil — nenhum bônus de 3º/4º |

### 3.3 Pontuação proposta

| Evento | Pontos | Observação |
|---|---|---|
| Placar exato de uma partida | 10 | Substitui os demais — nunca soma com os itens abaixo na mesma partida |
| Resultado da partida certo (V/D/E) | 5 | Só conta se o placar não foi exato |
| Gols de um dos dois times exatos | 1 por lado | Só conta se nem o placar nem o resultado bateram |
| Classificado do confronto certo | 5 | Bônus **por confronto**, separado da pontuação de partida — soma independentemente do placar de cada perna |
| Campeão | 30 | **Confirmado — mantém o valor atual, não muda para 25** |
| Vice-campeão | 20 | **Confirmado — mantém o valor atual, não muda para 15** |

**Comparação com o valor atual** (`config.js` hoje): `tie.exact: 10` / `tie.advance: 5` /
`tie.partial: 1` já são mutuamente exclusivos (`if/else if/else if`, nunca somam) — essa parte
da lógica **já está certa** e pode ser reaproveitada quase sem mudança, só trocando a unidade
de "placar exato do confronto" para "placar exato da partida". A mudança real é: o "5 pts por
avanço certo" deixa de ser comparado dentro do mesmo placar da partida e passa a ser um bônus
**separado, por confronto**, computado a partir de `qualifiedTeamId` — isso é puramente
estrutural, os valores em pontos não mudam.

### 3.4 Cutoff por fase

- `Phase.cutoffAt` = 1h antes do primeiro jogo da fase (mesmo critério já usado por confronto
  hoje, só que aplicado à fase inteira agora).
- Depois do cutoff da fase, nenhum palpite daquela fase pode ser criado/alterado.
- Admin sempre pode lançar resultado, independente de cutoff.
- Próxima fase permanece `WAITING_DRAW` até o admin publicar os confrontos oficiais (ação
  manual — não há sorteio automatizado no sistema, é sempre o Eduardo digitando o resultado do
  sorteio real).

### 3.5 UX — o que reaproveitar da Copa, o que não

**Reaproveitar (idêntico):** header, navegação, botões, inputs, cards, tipografia, cores,
espaçamento, breakpoints mobile/desktop, padrão de admin, pagamentos, estrutura de ranking
(`.rank-row`/`.picks-detail`), toasts, empty states — nenhuma mudança de design system, só de
dado/estrutura por trás.

**Não reaproveitar:** bracket fixo, relações `Winner Match N` equivalentes, 3º/4º lugar,
progressão automática de um chaveamento pré-conhecido, qualquer coisa ligada a "90 minutos +
prorrogação" (não existe prorrogação na Copa do Brasil — decide direto por pênaltis em partida
única, ou por agregado/pênaltis em ida+volta), estruturas específicas de seleção nacional
(bandeiras — CDB2026 já usa escudo real de clube, isso já está certo).

---

## 4. Plano de Migração

### 4.1 Pré-condição obrigatória

**Confirmar com Eduardo, antes de qualquer código:** existe alguma entrada real salva (local ou
Supabase) no CDB2026 hoje? Ver pergunta 11 da auditoria — evidência aponta para não, mas
precisa de confirmação explícita antes de decidir a estratégia de migração de dados.

### 4.2 Se NÃO existem entradas reais (cenário mais provável)

- Migração é uma **reescrita limpa**, não uma transformação de dado.
- `bolao/cdb2026/js/data.js`: substituir `DATA.ties` fixo pelo novo formato `Phase[]`, com só a
  1ª Fase pré-cadastrada (assumindo que o sorteio da 1ª fase já é conhecido — Eduardo confirma
  quais confrontos reais existem hoje) e as demais fases em `WAITING_DRAW`.
- `state()`/`emptyState()`: novo formato de `results`/`picks` (`matchPredictions`,
  `qualifiedPredictions`, etc.), sem necessidade de conversão — o `storeKey` do `localStorage`
  pode até mudar de nome (`bolao_cdb2026_state` → `bolao_cdb2026_state_v2`) para garantir que
  nenhum navegador com dado de teste antigo tente carregar um formato incompatível
  silenciosamente.
- Nenhum dado real é perdido porque não há dado real a perder.

### 4.3 Se EXISTIREM entradas reais (cenário de contingência)

- **Não sobrescrever nada automaticamente.** Exportar backup completo (JSON) do estado atual
  antes de qualquer mudança de schema.
- Escrever uma função de migração explícita (`migrateStateV1ToV2()`) que converte cada entrada
  antiga (`picks.ties[tieId] = {goalsA, goalsB, advance}`, agregado direto) em um registro
  `ruleVersion: "v1-aggregate"` mantendo o dado original intacto num campo de compatibilidade —
  nunca recalcular retroativamente um "placar de partida" que o participante nunca de fato
  informou (ele só digitou o agregado, não dá pra inventar quanto foi cada jogo).
- Entradas antigas ficam pontuadas pela regra antiga (`ruleVersion` grava qual valia no momento
  do palpite) até o admin decidir uma migração manual caso a caso, se fizer sentido.
- Rollback: manter a versão v2.9 completa (código-fonte já está no histórico do git) — reverter
  é `git revert` do(s) commit(s) da migração.

### 4.4 Ordem de implementação recomendada (só após aprovação)

1. `data.js`: novo formato `Phase[]`/`Tie[]`/`Match[]`, 1ª Fase populada, demais em
   `WAITING_DRAW`.
2. `state()`/`emptyState()`/`mergeStates()`: novo formato de `results`/`picks`.
3. `renderPickForm()`: uma linha de palpite por `Match` (não mais por confronto agregado),
   agregado calculado e exibido em tempo real, seletor de classificado obrigatório só quando o
   agregado previsto empata.
4. `scoreEntry()`: pontuação por partida (exato/resultado/lado, mutuamente exclusivos) + bônus
   de classificado por confronto (5 pts) + bônus de campeão/vice (25/15, **pendente
   confirmação de valor**).
5. Admin: CRUD de fase (criar/importar depois do sorteio, definir formato, cadastrar datas/
   locais, abrir/fechar, lançar resultado por partida, selecionar classificado real).
6. Regras/transparência: reescrever explicando o modelo novo com os 2 exemplos concretos do
   pedido original (ida+volta com pênaltis; partida única com pênaltis).
7. Testes (ver seção 6) — 24 cenários mínimos, `node --check` em todo JS alterado.
8. `bolao/cdb2026/CHANGELOG.md`, `docs/bolao/PROJECT_MEMORY.md`,
   `docs/bolao/CONSISTENCY_MATRIX.md`, `docs/bolao/QA_MASTER_CHECKLIST.md` atualizados no mesmo
   patch.

---

## 5. Perguntas respondidas (2026-07-13)

1. Não existem entradas reais → seção 4.2 (reescrita limpa) se aplica.
2. Bônus de campeão/vice: **mantido 30/20**, não muda para 25/15.
3. 1ª Fase: confrontos conhecidos, mas cadastrados via admin dentro do app, não hardcoded em
   `data.js` — nenhuma fase vem pré-populada no código, todas (incluindo a 1ª) nascem
   `WAITING_DRAW` e o admin cadastra os confrontos reais assim que o app estiver pronto.
4. `entryFee`/prêmio: **sem mudança** (US$5, 70/20/10).
5. Ida e volta a partir da 5ª fase (incluindo semifinal), confirmado pelo texto original do
   regulamento — não fazia parte das perguntas por já estar inequívoco na especificação.

---

## 6. Plano de Testes (mínimo, roda depois da implementação aprovada)

1. Partida única com vencedor no tempo normal.
2. Partida única empatada, classificado decidido nos pênaltis (placar considerado continua o do
   tempo normal).
3. Ida e volta, mesmo time vencendo os dois jogos.
4. Ida e volta, cada time vencendo um jogo, saldo de gols diferente.
5. Ida e volta, agregado empatado, decisão por pênaltis.
6. Um dos dois jogos termina empatado (mas agregado não empata).
7. Palpite de placar exato (partida).
8. Palpite acerta só o resultado (V/D/E).
9. Palpite acerta só os gols de um dos dois times.
10. Classificado certo com placares errados.
11. Placares certos com classificado errado.
12. Fase em `WAITING_DRAW` (sem confrontos ainda).
13. Fase `LOCKED` (cutoff passou).
14. Cutoff por fase — cada fase fecha independentemente.
15. Jogo adiado.
16. Jogo cancelado.
17. Alteração de horário depois de palpites já salvos.
18. Duas abas abertas simultaneamente.
19. Supabase offline (`database.enabled: false`, comportamento atual).
20. Migração de estado antigo (se aplicável — ver seção 4.3).
21. Exportação e restauração de backup.
22. Ranking antes e depois do jogo de volta.
23. Classificado decidido nos pênaltis refletido corretamente no ranking.
24. Final em partida única (não ida+volta).

`node --check` obrigatório em todo `.js` alterado. `python3 bolao/copa2026/scripts/audit_scoring.py`
continua sendo rodado e reportado (não afeta CDB2026 hoje, mas é regra permanente do
repositório — confirmar que nenhuma mudança vazou para `bolao/copa2026/js/data.js` ou
`bolao/copa2026/js/config.js`).

## 7. Sincronização com ESPN (v3.1 → v3.3, 2026-07-13)

Depois da reformulação v3.0, as fases começam vazias (`data.js` não tem mais bracket
hardcoded — ver seção 3). Eduardo pediu para popular os confrontos reais e automatizar isso após
cada sorteio.

**v3.1 (primeira versão):** busca sob demanda, admin clicava "Buscar", revisava a lista e
confirmava confronto por confronto (fase + clique "Adicionar" em cada linha). Eduardo testou e
achou o fluxo ruim — clicar em cada confronto individualmente era tedioso.

**v3.3 (atual) — automático, uma decisão só:**

- **A única decisão que continua manual: qual fase é "a atual" agora**
  (`s.espnSync.activePhaseId`, um seletor no admin). Não dá para inferir isso com segurança a
  partir dos dados da ESPN sem verificação ao vivo do agrupamento de fases/rodadas (não foi
  possível confirmar — ver limitação abaixo) — depois de escolhida, fica valendo até o admin
  trocar de novo (ex.: quando a fase atual termina e a próxima é sorteada).
- **Com a fase ativa definida, tudo o resto é automático.** A sincronização roda sozinha: ao
  abrir o painel admin, a cada 5 minutos se ele continuar aberto, e via um botão "Sincronizar
  agora" para forçar na hora. Confrontos novos (par de times ainda não cadastrado em nenhuma
  fase) são criados sem nenhum clique adicional.
- **O que NUNCA era automatizado até v3.15: travar um resultado.** Isso decide o pagamento. Até
  v3.15, a sincronização só pré-preenchia o placar de uma partida única já finalizada na ESPN —
  travar o resultado/classificado exigia o fluxo manual em "Resultados". Para `TWO_LEG`, os
  placares de cada perna eram 100% manuais (risco de casar a perna errada automaticamente).
  **Revertido em v3.16** — ver nota abaixo.

> **v3.16 (2026-07-14) — automação estendida a RESULTADO, com autorização explícita de Eduardo.**
> Eduardo pediu para "automatizar a atualização de placar do admin". Antes de implementar, foi
> apresentado exatamente o risco descrito no parágrafo acima (decide pagamento; casar a perna
> errada seria grave) — Eduardo confirmou explicitamente que queria a automação mesmo assim.
> Implementado (`autoSyncEspnResults()`, `bolao/cdb2026/js/app.js`) com salvaguardas que preservam
> a intenção original deste documento o máximo possível:
> - **Perna certa por identidade do mandante**, não ordem de data — ida e volta têm mandantes
>   sempre invertidos entre si por definição de mata-mata; não há ambiguidade nesse sinal.
> - **Nunca sobrescreve** uma perna já preenchida (manual ou auto) nem um confronto já travado
>   (manual ou auto) — corrigir ainda exige "Destravar" na UI.
> - **Agregado não empatado**: trava automaticamente, vencedor inequívoco pelo placar (mesma regra
>   que o botão manual sempre usou).
> - **Agregado empatado** (só decide nos pênaltis): só trava automaticamente se a ESPN reportar um
>   vencedor explícito (`winner`); sem esse dado, cai pro fluxo manual — nunca adivinha.
> Ver `bolao/cdb2026/CHANGELOG.md` v3.16 e `docs/bolao/CONSISTENCY_MATRIX.md` para o registro
> completo da decisão.
- **Dedup por par de times + IDs determinísticos.** Um confronto cujo par de times já existe em
  qualquer fase nunca é recriado. IDs de confrontos auto-adicionados são determinísticos
  (`espn-<time-a>_<time-b>`, normalizado e ordenado), não aleatórios — se dois dispositivos
  sincronizarem de forma independente antes de se encontrarem no Supabase, os dois geram o
  mesmo id para o mesmo confronto real, e o merge por chave colapsa em uma entrada só em vez de
  duplicar. Confrontos adicionados manualmente (fora da sincronização) continuam com id
  aleatório — sem esse risco de corrida, e sem necessidade dele.

**Limitação conhecida, ainda não resolvida:** o slug `bra.copa_do_brazil` foi confirmado apenas
via busca pública (WebSearch), não por uma chamada real ao endpoint — o ambiente de
desenvolvimento não tem acesso de rede a hosts externos (política de proxy do sandbox bloqueou
`site.api.espn.com`, `cbf.com.br`, `wikipedia.org` e qualquer outro host arbitrário). Se o slug
estiver errado ou a ESPN não cobrir bem a Copa do Brasil, a sincronização simplesmente não
encontra nada ou mostra erro (mensagem visível no admin) — não há caminho silencioso de falha
que grave dado errado.

### 7.1 População inicial das Oitavas de Final (v3.6, 2026-07-14)

A ferramenta de sincronização acima resolve "manter atualizado", mas ainda depende do admin
acessar o painel e escolher a fase ativa — e o ambiente de desenvolvimento não tem como verificar
se isso realmente aconteceu ou empurrar dados para o Supabase remotamente. Eduardo pediu, pela
terceira vez, para os confrontos já sorteados aparecerem prontos para palpite. Mudança de curso
deliberada: `DATA.knownConfrontos` (`data.js`) declara os 8 confrontos reais das Oitavas
(sorteio da CBF de 26/05/2026), e `seedKnownConfrontos()` (`app.js`) os cadastra automaticamente
na primeira carga do app — uma única vez, nunca reaplicado (ver comentário no código).

**Isso não contradiz o princípio "não fica confronto hardcoded" da seção 3** — aquele princípio
existe para não *inventar* um chaveamento antes do sorteio real acontecer. Estes 8 confrontos já
são fato consumado (sorteio já ocorreu, é público), só ainda não cadastrados manualmente — a
diferença entre "prever o futuro" e "digitar um fato já conhecido mais rápido".

**Confiança dos dados**: cruzados entre 3+ fontes jornalísticas independentes por par, incluindo
o site oficial do Corinthians para o confronto Corinthians×Internacional. Uma busca inicial
retornou um resultado contraditório (uma notícia de "Corinthians x Palmeiras" que, ao investigar,
veio de uma matéria de outro ano misturada nos resultados de busca) — descartado depois que uma
busca mais específica ("Corinthians adversário Copa do Brasil 2026") confirmou
Corinthians×Internacional de forma consistente em 5+ fontes. Ainda assim, **nada disso foi
verificado contra uma chamada direta à API oficial da CBF/ESPN** — o mesmo limite de rede da
seção 7 acima. Eduardo deve conferir contra a tabela oficial antes do prazo de palpites; qualquer
erro é corrigível pela tela "Fases e confrontos" (remover + admin cadastra o correto), sem risco
a resultado nenhum (nenhum foi lançado ainda para essa fase).

Também corrigido durante a v3.1: a CSP (`Content-Security-Policy`) do `index.html` do CDB2026
não incluía `site.api.espn.com` em `connect-src` — sem essa correção, qualquer fetch a esse host
teria sido bloqueado pelo próprio navegador do Eduardo em produção, independente do sandbox. Bug
real, pré-existente, encontrado ao testar a feature.

### 7.2 População das fases já concluídas (1ª–5ª) e remoção do formulário de palpites (v3.7, 2026-07-14)

Eduardo pediu duas coisas: (1) popular "os jogos anteriores" do CDB2026 do mesmo jeito que os
outros bolões, "só para referência"; (2) tirar do formulário de palpites as fases que já
passaram. As duas pedem a mesma investigação de base: o torneio tem 126 times e 5 fases antes das
Oitavas (todas de mão única, exceto a 5ª, que já é ida-e-volta) — todas as 5 já tinham acabado
antes deste bolão existir (a própria Oitavas já foi sorteada em 26/05/2026, então tudo antes disso
necessariamente já aconteceu).

**Escopo — decisão do Eduardo (2026-07-14)**: pesquisado o formato real (fontes: Wikipédia PT,
CBF, Olympics.com) — 1ª a 4ª fase somam 90+ partidas de times estaduais/regionais menores, com
fontes bem mais esparsas que a 5ª fase (que já é Série A + os 12 classificados das fases
anteriores, 32 times, 16 confrontos, cobertura de imprensa muito melhor). Apresentado o trade-off
a Eduardo via pergunta direta (esforço/risco de erro em ~90 jogos de times menores vs. ~16
confrontos bem cobertos); ele escolheu popular **só a 5ª fase** em detalhe. 1ª–4ª ficam marcadas
como já concluídas, sem placar partida a partida (`DATA.phasesConcludedNoData` em `data.js`).

**5ª Fase — dados**: `DATA.knownConfrontos["fase-5"]` (`data.js`) tem os 16 confrontos com
`winner` + `legs` (ida e volta, ambos os placares) — formato diferente da Oitavas (que só tem
`teamA`/`teamB`, sem resultado, porque ainda não foi jogada). `seedKnownConfrontos()` (`app.js`)
foi generalizada para aceitar os dois formatos: confronto futuro (matches vazios, como já era) ou
confronto já decidido (matches com placar real + `qualifiedTeamId` setado direto do `winner`
conhecido, não derivado do placar — 2 dos 16 confrontos foram decididos nos pênaltis com agregado
empatado, mesma convenção que o app já usa pra qualquer confronto de pênaltis, ver
`rulesPenaltyText`).

**Validação cruzada forte**: os 16 vencedores da 5ª fase batem exatamente com os 16 times já
cadastrados nas Oitavas (nenhum de menos, nenhum a mais, nenhum duplicado) — dado que essas duas
fontes foram pesquisadas independentemente (a Oitavas na v3.6, a 5ª fase agora), essa coincidência
perfeita é evidência forte de que ambos os conjuntos de dados estão corretos. Confirmado
programaticamente em teste (`test_fase5_seed.js`).

**Confiança dos dados**: pesquisa cruzando 2+ fontes independentes por confronto (site oficial do
clube, ge.globo/CNN Brasil/ESPN, cobertura local) para ida, volta e vencedor — nenhum dos 16
ficou sem confirmação. Dois resultados de busca inicialmente errados foram pegos e corrigidos
antes de entrar no código: Atlético-MG×Ceará (resumo automático errou o placar da volta) e
Flamengo×Vitória (resumo alucinou o placar da ida) — ambos corrigidos depois de cruzar 3+ fontes
independentes cada. Mesmo limite de rede das seções anteriores (sem chamada direta à API oficial
da CBF/ESPN neste ambiente) — CONFERIR contra a tabela oficial; corrigível pela tela "Fases e
confrontos" sem risco a pontuação (fase nunca esteve aberta a palpite).

**Remoção do formulário de palpites**: `renderPickForm()` agora pula qualquer fase totalmente
decidida (`phaseFullyResolved()`, generalização de `fase1Complete()` — verdadeiro quando a fase
tem confronto cadastrado e todos já têm `qualifiedTeamId`) e qualquer fase em
`DATA.phasesConcludedNoData` sem confronto cadastrado. Isso cobre tanto a 5ª fase (populada, mas
100% decidida) quanto a 1ª–4ª (sem dado nenhum) — nenhuma das duas tem o que apostar. A aba
"Jogos" continua mostrando as 5 fases normalmente: 1ª–4ª com uma nota de "já concluída antes do
início deste bolão" (troca do texto "aguardando sorteio", que seria enganoso — dá a entender que
a fase ainda vai acontecer), e a 5ª com os cards de confronto normais (placar real, agregado,
"avança: X").

**Testes**: `test_fase5_seed.js` (19 asserções, todas passando) — cobre contagem de confrontos
seedados, placar/vencedor de cada perna, a validação cruzada com a Oitavas, `activePhaseId`
permanecendo em `oitavas` (não sendo sobrescrito pela 5ª fase histórica), ausência de 1ª–5ª no
formulário de palpites, presença da nota de "já concluída" em Jogos, e idempotência no reload.

## 8. Card "ao vivo" trazido ao padrão da Copa/BR2026 + projeção de ranking ao vivo (v3.40, 2026-07-16)

Auditoria de consistência disparada por Eduardo ("PRECISAMOS SER CONSISTENTES!") depois do card
ao vivo do BR2026 ser refeito — ver `docs/bolao/CONSISTENCY_MATRIX.md` nota de 2026-07-16 pro
detalhe completo. `renderLiveTieCard()` já existia (poll de 60s, relógio, intervalo/pênaltis)
mas ainda usava a pilha vertical antiga; refeito com a mesma estrutura/tokens já portados pro
BR2026 (`.live-top/.live-team/.live-score/.live-center`), plays feed (gols/cartões/subs), sem
badge de posição de tabela (mata-mata, sem classificação de liga).

**Projeção de ranking ao vivo** — diferente do BR2026 (que reage ao placar via a tabela de
classificação ajustada), o CDB2026 pontua por PARTIDA (`matchPoints()`), não por posição numa
tabela. `liveScoreEntry(entry, s)` soma os pontos de cada partida ao vivo (`_liveTies`) por cima
do total oficial (`scoreEntry()`), usando o placar em andamento diretamente — nunca tenta prever
quem se classifica ao vivo (isso depende do agregado ida+volta, possivelmente + prorrogação/
pênaltis, especulativo demais enquanto uma perna ainda está rolando). `rankEntriesBy(entries,
scoreFn)` extraído como única implementação do desempate (antes só existia inline dentro de
`renderRanking()`), reaproveitado por `calculateRankingMovement()` também — mesmo princípio
"fonte única" da nota do BR2026 sobre `rankEntries()`.

`calculateRankingMovement(entries, s)`: baseline = `scoreEntry()` puro (sem placar ao vivo);
"atual" = `liveScoreEntry()` quando há tie(s) ao vivo, senão igual à baseline (sem jogo ao vivo,
não há "movimento" a calcular — status `"unavailable"`). Setas de movimento (`rankMovementHtml`)
aparecem no Ranking normal E no novo hero `#liveRankingHero` (mesmas classes CSS/i18n do BR2026,
namespace `.movement-*` nunca compartilhado com nada de posição de time — que nem existe aqui).

Hero mostra TODAS as entradas ordenadas por posição (não filtra só quem se move — mesmo ajuste
que o BR2026 precisou fazer depois, aqui já implementado direto no formato final), dentro de uma
caixa com scroll (`.live-ranking-scroll`, ~4-5 linhas visíveis, cabeçalho fixo). Só aparece com
tie(s) ao vivo E pelo menos um participante realmente subindo/descendo.

**"Próxima partida" com múltiplos jogos no mesmo dia**: `findNextUpcomingMatch()` continua
retornando só a partida mais próxima (usado como está em outros lugares); nova
`findAllUpcomingMatchesOnNextDay(s)` agrupa por dia (`brtDateKey()`, nova função, mesmo formato
do BR2026) em cima dela. Card mostra lista compacta quando há mais de uma partida no dia, mantém
o layout rico (contador regressivo) quando há só uma.

**Testado** com estado injetado (duas entradas, um confronto com perna "ao vivo" mockada via
interceptação da rota da ESPN no Playwright) — confirmado: card ao vivo renderiza corretamente,
plays feed aparece, hero de ranking aparece com a ordem/pontuação/setas certas, ranking exibido
reflete o placar ao vivo. `window.__CDB2026_TESTHOOKS__` adicionado (mesmo padrão do
`__BR2026_TESTHOOKS__`) expondo `rankEntriesBy, calculateRankingMovement, liveScoreEntry,
scoreEntry, matchPoints, extractMatchPlays` — funções puras, sem mutação de estado.

`audit_scoring.py`: PASSOU (5/5) — toda a mudança é apresentação + uma projeção aditiva que
nunca sobrescreve o resultado oficial salvo em `s.phases[...].matches[leg]`.

---

## Auditoria de código — 2026-08 (v3.54 → v3.55)

Relatório completo: `docs/bolao/CDB2026_CODE_AUDIT_2026-08.md`.

**O modelo de torneio e a pontuação NÃO mudaram.** Nenhum valor de pontuação, regra de
classificação, bônus de pódio (30/20), formato de fase ou dado esportivo foi alterado. O motor
oficial (`scoreEntry()`/`matchPoints()`) foi auditado e estava **correto**.

Confirmações relevantes para este documento:

- **Projeção ao vivo (§ "Projeção de ranking ao vivo") está correta como documentada.** Foi
  levantada a hipótese de que faltaria o bônus de campeão/vice no ranking ao vivo durante a
  final. Investigado: `liveScoreEntry()` soma apenas pontos de partida e **nunca** projeta pódio,
  exatamente como este documento já descrevia — decisão deliberada e conservadora (projetar quem
  se classifica depende do agregado ida+volta, possivelmente prorrogação/pênaltis). **Nada
  alterado.** Registrada como lacuna de teste: `liveScoreEntry()` não tem espelho no
  `audit_scoring.py`, então essa invariante ("nunca fabrica bônus enquanto o jogo rola") não está
  protegida contra uma refatoração futura.
- **Campeão/vice + pênaltis:** `officialPodium()` resolve só a partir de `tie.qualifiedTeamId`,
  que exige lock manual (com escolha explícita obrigatória em caso de empate no agregado) ou o
  sinal `homeWinner`/`awayWinner` da ESPN pós-pênaltis. Empate sem sinal **não** resolve vencedor.
  Correto nos quatro cenários testados.
- **Orientação mandante/visitante:** `goalsHome`/`goalsAway` são sempre relativos ao mandante
  **real da perna** (na volta, `teamB`). A partir da v3.55 existe uma função única,
  `legTeams(tie, leg, match)`, que **deve** ser usada em qualquer superfície nova que exiba um
  placar de perna — o comprovante, o detalhe do ranking e o CSV imprimiam `teamA × teamB` fixo e
  invertiam o placar da volta.
- **Sincronização ESPN grava sozinha.** Um comentário em `config.js` afirmava que a sync "nunca
  grava nada sem confirmação humana" — falso desde a v3.16: `autoSyncEspn()` cria confrontos e
  `autoSyncEspnResults()` preenche placares e chega a travar a classificação automaticamente.
  Comentário corrigido.
