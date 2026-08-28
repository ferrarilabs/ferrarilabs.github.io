# Bolão Brasileirão 2026 — CHANGELOG

## operacional — Cloudflare passa a ser somente o relógio do produtor (2026-08-28, Issue #246)

Sem bump de `siteVersion`: nenhum arquivo servido ao navegador mudou. O Worker
`ferrarilabs-live-producer` acorda a cada cinco minutos e dispara exclusivamente o workflow
`live_cache_producer.yml` em `main`. Ele não busca ESPN, não normaliza placar e não tem URL ou
credencial do Supabase.

O primeiro cron real da versão nova foi observado em `2026-08-28T11:30:57Z`: o dispatch foi
aceito, criou o run GitHub Actions `33167445536` e terminou verde. Como BR2026 e CDB2026 estavam
fora da janela derivada dos calendários, o produtor encerrou com `SKIPPED_OUT_OF_WINDOW` sem tocar
a fonte ou o cache — comportamento esperado, não falso frescor.

Rollback: a versão Cloudflare anterior continua disponível no histórico. Scoring, ranking,
palpites, pagamentos, e-mail e ledgers não foram tocados.

## 2026-08-26 — Issue #321: ações de suporte no cabeçalho (v1.130)

`Reportar problema` saiu do fim da página e passou a formar, ao lado de `Suporte WhatsApp`, um
grupo único de ações de suporte no cabeçalho. Os dois controles agora compartilham dimensões,
tipografia, espaçamento e comportamento responsivo; o reporte usa um `!` circular decorativo e
contido, sem aparência de ação destrutiva. Em 320 px eles ocupam duas metades equilibradas da
mesma linha, sem rolagem horizontal.

O acesso `Admin` continua sendo o mesmo botão `data-section="admin"`, com a mesma autorização e o
mesmo painel, mas foi retirado da navegação primária e colocado como utilitário discreto depois do
rodapé. Continua visível, focável por teclado e não depende de hover. A flag, o modal, o payload,
o Worker, scoring, ranking, pagamentos e controles de segurança não mudaram.

## 2026-08-25 — Issue #321: canal de reporte ABERTO ao público (v1.129)

Com autorização explícita do dono, o canal de **"Reportar problema"** foi **aberto a participantes**.

As duas chaves foram viradas — e nessa ordem, que é a ordem que importa:

1. **servidor** primeiro (`REPORT_INTAKE_ENABLED=true` no Cloudflare Worker isolado), verificado
   antes de qualquer UI aparecer;
2. **cliente** depois (`reportProblem.enabled: true` neste app).

O estado de rollout agora é **declarado uma vez** em `bolao/shared/safety/report_rollout.json`
(`PUBLIC_ENABLED`), e os gates que antes exigiam literalmente "desligado" passaram a exigir
**coerência** com essa declaração. A proteção não diminuiu: ligar continua exigindo uma alteração
visível e revisável, e passou a ser impossível ligar **metade** do canal (servidor sim, cliente
não, ou um app fora de sincronia) sem reprovar.

**Rollback** continua começando pelo servidor: `REPORT_INTAKE_ENABLED=false` é o que para
requisição de verdade. Esconder o botão não é rollback — um navegador com a página em cache
continua conseguindo POSTar.

Nada de scoring, ranking, entradas ou pagamentos foi tocado.

## 2026-08-25 — Issue #321: endereço do Worker e CSP (v1.128)

O endereço do Worker foi **decidido** e escrito neste app, e a CSP passou a permitir exatamente
essa origem:

```
https://ferrarilabs-support-intake.automotive-dashboard-private-status.workers.dev
```

`workers.dev` e não `report.ferrarilabs.com` porque a conta Cloudflare tem `zones = 0` — verificado
pela API, não suposto. Um subdomínio próprio exigiria mover o DNS de `ferrarilabs.com` inteiro,
arrastando site, GitHub Pages e e-mail para uma migração alheia a este canal. Domínio próprio fica
como endurecimento futuro; trocar depois é uma rota nova mais uma linha de CSP. Ver ADR-021,
"Endereço público".

**Isto não liga nada.** `reportProblem.enabled` continua `false`, então a UI não monta e não há
botão. E o servidor tem a chave que de fato importa: `REPORT_INTAKE_ENABLED != "true"` faz toda
requisição morrer em 503 antes de tocar Durable Object, rate limit, GitHub ou segredo. Preencher o
endpoint é a metade mais fraca das duas chaves — o rollback começa sempre pelo servidor, porque
apagar a URL daqui só esconde o botão e um navegador com a página em cache continua conseguindo
POSTar.

Hoje o endereço responde `404`: o recurso Worker existe na Cloudflare, mas o deploy está **bloqueado
de propósito** — `wrangler.jsonc` declara `secrets.required`, e o deploy recusa enquanto faltarem os
três segredos da GitHub App, que ainda não existe.

**Na CSP, origem exata e nunca curinga.** `*.workers.dev` é um domínio compartilhado por todas as
contas Cloudflare do mundo; um curinga autorizaria o Worker de qualquer estranho a receber POST
desta página. Há catraca proibindo isso.

---

## 2026-08-24 — Issue #321: intake migrado para Cloudflare Worker (v1.127)

O canal de reporte mudou de runtime: deixou de ser uma Edge Function do projeto Supabase que
guarda participante, pagamento e scoring, e virou um **Cloudflare Worker isolado**
(`ferrarilabs-support-intake`). Motivo em `docs/bolao/adr/ADR-021-intake-em-cloudflare-worker.md`.

Em uma frase: no Supabase os segredos do projeto sao **injetados** em toda Edge Function; num Worker
os bindings sao **declarados**. O que nao esta no `wrangler.jsonc` nao existe no ambiente.

**O que muda neste app:** so o `endpoint` do `reportProblem`, que ficou **vazio**. Ele sera
preenchido no momento da ativacao, quando o endereco publico do Worker existir. Deixar a URL antiga
apontaria o cliente exatamente para o runtime que a migracao existe para abandonar.

**Nada aparece:** `reportProblem.enabled` continua `false`, e sem endpoint o componente nao monta.
As duas chaves de ativacao seguem desligadas.

**Scoring, ranking, entradas e pagamentos: intocados.**


## 2026-08-24 — Issue #321: versao do aviso de privacidade no coletor (v1.126)

O coletor compartilhado (`bolao/shared/js/report_safe_context.js`) passa a enviar
`noticeVersion` — qual versao do aviso de privacidade a pessoa VIU ao enviar o relato.

O texto do aviso vai mudar. A partir dai, "o que foi comunicado a esta pessoa" viraria pergunta de
memoria, e essa e exatamente a pergunta que importa se alguem pedir remocao ou questionar o que foi
coletado.

**Nada aparece e nada e enviado:** `reportProblem.enabled` continua `false`, e o canal segue inerte
tambem no servidor.

**Scoring, ranking, entradas e pagamentos: intocados.**


## 2026-08-24 — Issue #321: UI de reporte, montada e desligada (v1.125)

Entra o componente compartilhado do "Reportar problema" (`bolao/shared/js/report_ui.js` e
`report.css`): modal acessivel, quatro idiomas (pt-BR, en, es, ja), foco preso enquanto aberto,
`Escape` fecha, foco devolvido ao elemento de origem, e tela cheia a partir de 320px — porque
caixa flutuante em 320px vira janela de 280px com scroll duplo.

**Nada disso aparece.** `reportProblem.enabled` continua `false`, e com a flag desligada o
componente nao cria botao, nao registra listener e nao toca no DOM. O ponto de montagem no HTML
fica um `<div>` vazio. Um botao visivel sem backend aceito seria um botao morto — pior que a
ausencia dele, porque ensina o participante que reportar nao funciona.

O modal traz o aviso de privacidade em destaque (nao escondido atras de clique) e uma divulgacao
tecnica recolhida que mostra o objeto REAL que sairia do navegador, campo a campo — se algum campo
novo entrar no coletor, ele aparece la sozinho. E diz a verdade sobre expectativa: este canal nao e
suporte e nao garante resposta.

**Scoring, ranking, entradas e pagamentos: intocados.** Os tres `audit_scoring.py` continuam
passando.


## 2026-08-24 — Issue #321: canal de reporte de problema, desligado (v1.124)

O app ganha a chave de configuracao `reportProblem`, **desligada** (`enabled: false`), e mais
nada: nenhuma UI, nenhuma requisicao, nenhuma mudanca de comportamento para o participante.

A Edge Function `user-report-intake` foi implementada no mesmo PR mas **nao esta implantada**, e
nenhum dos oito segredos exigidos existe. Enquanto isso for verdade, um botao visivel seria um
botao morto — pior que nao ter botao, porque ensina o participante que reportar nao funciona. Por
isso a UI fica para a fase 2, junto com a provisao de producao.

O canal foi desenhado como um intake de incidentes **externo e nao confiavel**: o relato bruto vai
para um repositorio **privado** e nunca cruza automaticamente a fronteira privado->publico. O
endpoint nao alcanca banco de participante, pagamento, scoring nem competicao.

**Scoring, ranking, entradas e pagamentos: intocados.** Os tres `audit_scoring.py` continuam
passando.

Detalhe completo — modelo de ameacas, dados coletados e excluidos, retencao, rollback e runbook de
triagem — em `docs/bolao/SECURE_USER_REPORTING.md`.


## 2026-08-22 — Issue #296: frescor em três estados (v1.123)

O dado ao vivo passa a ter três estados explícitos, classificados pela **idade do dado**, e a UI
passa a dizer **quanto** de atraso existe em vez de um "pendente" genérico.

    idade <= 10 min            FRESH               apresentação normal
    10 min < idade <= 30 min   STALE_BUT_USABLE    mostra, rotulado "Atualização atrasada · há N min"
    idade > 30 min             UNAVAILABLE         não é apresentado como verdade ao vivo

**Por que.** Medição de 2026-08-22 sobre 60 execuções agendadas reais: a cadência nominal do
produtor é de 5 em 5 minutos, mas o GitHub *entrega* com mediana de 25,1 min (min 15,2 · máx 99,5).
Fila 0s na mediana e no máximo, execução ~15s, zero cancelamentos — a causa é a entrega do
agendador, **não** enfileiramento, `cancel-in-progress` ou execução longa. Nenhum intervalo
observado cabia no teto de 10 min que existia.

A escolha foi representar o atraso com honestidade em vez de subir o teto e passar a chamar de
fresco um dado de meia hora. Nenhuma infraestrutura nova de agendamento foi criada.

**Dois defeitos de rotulagem corrigidos, em direções opostas:**

- Um cache de 16 segundos era marcado `STALE` só porque a ESPN tinha falhado naquele instante — a
  classificação seguia o desfecho do *fetch*, não a idade do dado. A UI acendia aviso de atraso
  sobre dado fresco. Agora a falha da fonte viaja em `sourceDegraded`, separada do frescor.
- Um dado de 12 minutos virava `SOURCE_UNAVAILABLE` (tela sem jogo) mesmo sendo perfeitamente útil
  se dissesse a idade.

**Fonte única de limiar.** Os dois valores existem uma vez, em
`supabase/functions/_shared/freshness_contract.js`. O `football_live_store.js` do navegador é script
clássico servido sem build e não pode importar ESM, então mantém uma cópia — **conferida** contra o
contrato por `bolao/scripts/test_freshness_contract.mjs`, que reprova se divergirem. O mesmo gate
varre o repositório atrás de qualquer terceiro arquivo que *defina* um limiar de frescor por conta
própria, e tem controle negativo provando que a varredura morde.

**Ler não rejuvenesce dado.** `classifyFreshness()` recebe uma idade e nada mais: não recebe o
registro de cache, não pode escrevê-lo, e nenhum caminho de leitura devolve `shouldStore: true`.
Testado com mil leituras seguidas (bytes idênticos), com leitura posterior (a idade só piora), e
com o caso da gravação recente de observação velha — que não vira fresco pelo atalho de TTL, porque
a idade sai de `observedAt`, não de `storedAt`.

**Compatibilidade de fio preservada.** `health`/`status` continuam emitindo `FRESH`/`STALE`/
`SOURCE_UNAVAILABLE`: navegador já implantado testa `body.status === "SOURCE_UNAVAILABLE"` com JS
cacheado. `health` virou alias 1:1 do estado novo (`healthForFreshness()`, que lança em estado
desconhecido em vez de virar `FRESH` em silêncio), não uma segunda verdade. O estado novo viaja no
campo aditivo `freshness`.

**Achados corrigidos junto, e reportados:**

- O fixture `STALE` de `live_gateway_fixtures.mjs` usava observação de 4 min — que sob o contrato
  novo é `FRESH`. Ele passaria a afirmar um estado impossível de produzir. Agora é derivado do
  contrato (ponto médio da faixa).
- `test_live_producer_cadence.mjs` lia o teto por regex sobre o texto do gateway; quando a
  constante virou derivada, o caso morreu com "não consegui ler" — indistinguível de um gate que
  leu um número errado. Agora importa `FRESH_MAX_AGE_MS` (que continua 10 min: a cadência precisa
  entregar *fresco*, não apenas *servível*).
- `staleReason` colapsava "a fonte não respondeu" em `DATA_AGE`. Agora são três motivos distintos:
  `UPSTREAM_<n>`, `UPSTREAM_UNREACHABLE` e `DATA_AGE` (envelhecimento sem tentativa).
- A mutação M34 do contrato de segurança ficava inerte enquanto o commit em curso declarasse
  `EDGE_FUNCTIONS` por motivo legítimo. Agora ela produz a própria ausência de declaração
  (`mutateFixtures`), em vez de torcer para que ela exista.

**Propagação.** CDB2026 não tem badge de frescor no hero — seu `liveClockStale` significa outra
coisa (o minuto não é demonstrável, não "o dado está atrasado"), então a chave com idade não foi
adicionada lá para não virar código morto. Copa2026 está arquivada e não tem hero ao vivo.

Gates: `freshness-contract` (33), `live-gateway` (31, era 25), `football-live-store` (21, era 19).

## 2026-08-18 — Issue #221: correção definitiva -- ledger de rodada durável (F8)

Substitui `SupabaseStateRoundLedgerRepo` (removido) por `AtomicRoundLedgerRepo`, que persiste em
uma tabela dedicada (`bolao_round_notif_jobs`, migração
`bolao/shared/sql/030_br_round_notification_durability.sql`) via RPCs `security definer` --
mesmo padrão de segurança já provado em `010_notification_durability.sql`/`020_notif_recipient_rpcs.sql`
(entry_ref opaco, RLS sem policy para `anon`, atomicidade dentro da RPC). A máquina de estados de
`RoundLedger` (`round_notification_ledger.py`) **não mudou** -- já estava correta e testada; só a
camada de persistência por baixo dela era o defeito.

**Prova de exactly-once ENTRE processos separados** (`test_round_email_durable_ledger.py`, gate
`br-round-email-durable-ledger`), não só dentro do mesmo objeto Python: reproduz o defeito real
com um repositório não durável (4 execuções frescas, 11 envios em CADA uma -- o mesmo padrão do
incidente), depois prova zero duplicatas com o repositório novo em 100 execuções sequenciais e 10
workers concorrentes (via lock na reivindicação atômica, modelando o `UPDATE` de linha única que o
Postgres protege nativamente), parcial retenta só quem falhou, incerto nunca reenvia
automaticamente, e a fiação de produção (`run_auto()`) de fato usa o repositório durável -- prova
manual de que reverter essa linha faz o gate ir vermelho.

**Achado separado, corrigido no mesmo patch por ser trivial e do mesmo arquivo**:
`notification_states_from_round_ledger()` chamava `ledger.get()` uma vez por rodada do manifesto
(até 38 chamadas RPC por execução, sem tratamento de erro) -- inofensivo enquanto o repositório
era um dict local, mas seria lento e frágil contra rede real. Trocado por uma leitura em lote
(`repo.list_by_prefix()`).

**Ainda pendente, não incluído neste patch**: aplicar `030_br_round_notification_durability.sql`
em produção, aplicar o backfill de reconciliação da rodada 23
(`bolao/shared/sql/INCIDENT_221_backfill_round23_sent.sql`, evidência extraída dos logs reais do
GitHub Actions -- run 32101043496 -- não inferida), e só então rearmar
`br2026_round_emails.yml`. O workflow permanece DESARMADO até essas três etapas serem concluídas
e verificadas.

## 2026-08-18 — INCIDENTE: e-mail da R23 enviado 4x para os 11 participantes reais (Issue #221)

**Envio real de e-mail de rodada DESARMADO** (`.github/workflows/br2026_round_emails.yml`:
`--auto` -> `--dry-run`, `BOLAO_ALLOW_REAL_SEND` removido) ate a causa raiz ser corrigida.

Quatro execucoes agendadas independentes (2026-08-17 22:45 ET .. 2026-08-18 00:57 ET)
reivindicaram a mesma `idempotencyKey` (`br2026:round-results:23:v1`) e enviaram, cada uma,
para os 11 participantes -- 44 envios reais em vez de 11.

**Causa raiz**: `SupabaseStateRoundLedgerRepo` (`send_round_email.py`) alega durabilidade na
propria docstring, mas nunca grava `bolao_state.roundEmail.ledger` de volta no Supabase --
`sb_fetch()` e so leitura, e o caminho de escrita de documento inteiro (`sb_upsert`) foi
removido antes por outro motivo de seguranca, sem substituto para este ledger. Cada execucao
parte do mesmo estado obsoleto e reenvia. Reproduz em qualquer rodada futura, nao so na R23.

Nenhum e-mail corretivo automatico foi enviado aos 11 participantes. Nenhuma pontuacao,
classificacao ou pick foi alterada. Correcao definitiva (religar o ledger a armazenamento que
realmente persiste) ainda nao autorizada/implementada -- ver Issue #221.

## 2026-08-16 — `check_standings_layout` fotografava um ponto fora da tela

**Somente teste. A tabela de classificação nunca esteve errada** — nenhum CSS, HTML ou JS do
produto foi tocado.

Regressão encontrada ao rodar `npm test` depois do commit `173bae02` (`chore(espn): refresh
br2026 snapshot`, do bot). O gate quebrava com um erro do Playwright, não com um achado de
layout: `page.screenshot: Clipped area is either empty or outside the resulting image`.

**Causa raiz.** `sampleRowColors()` recorta um screenshot em coordenadas de **viewport** (é o que
`{clip}` sem `fullPage` faz), usando caixas vindas de `getBoundingClientRect()` — também de
viewport. As duas só coincidem enquanto a linha estiver **visível**, e nada garantia isso: a
linha caía dentro da janela por efeito **colateral** do clique no botão de navegação, que rolava
a página. Medido nos dois estados:

| | hero ao vivo | altura da página | scrollY em 1440x900 | topo da linha |
|---|---|---|---|---|
| `f93b942e` (verde) | presente, 273px | 2001px | 595 | 563 ✓ |
| `173bae02` (vermelho) | ausente | 1778px | 0 | **961** ✗ (janela de 900) |

Quando nenhum jogo está ao vivo o hero some, a página encurta, a rolagem incidental deixa de
acontecer e a linha vai parar abaixo da dobra. Não é um caso raro: **é o estado normal fora do
horário de jogo**, e teria deixado a suíte vermelha durante o fechamento da R23.

**Correção**: a linha é rolada para o centro da tela e as caixas são **relidas** depois disso,
antes da foto. Sem depender mais de rolagem incidental de terceiros.

**A asserção continua mordendo**: com `td:nth-child(4) { background: #ff00ff }` injetado, o gate
acusa `row-status-background-discontinuous` com as amostras em `[255,0,255]`. 8/8 viewports
verdes sem a mutação.

## 2026-08-16 — gate de fechamento de rodada e e-mail pós-apito-final

**Somente teste. Nenhuma mudança de comportamento de produto**: `round_state.py`,
`send_round_email.py` e o ledger não foram tocados, e por isso não há bump de `siteVersion`
(nada que o navegador baixe mudou).

Novo gate `bolao/br2026/scripts/test_round_close_preflight.py`, registrado em
`npm run test:notifications` e em `scripts/verify.mjs`. Ele exercita o **código de produção**
(`derive_round_notification_state()` e `_process_round()`) com rodadas sintéticas e transporte
falso: zero rede, zero Supabase, zero e-mail, zero escrita de produção. 63 asserções em 0,2 s.

**É genérico de propósito.** Nada nele depende do número da rodada corrente, da data de hoje, de
um id real da ESPN ou de qual time joga por último — as rodadas são sintéticas, parametrizadas
por N (8/10/12 jogos × 3 numerações), e o relógio é fixo. Um gate que soubesse que "a R23 fecha
com Internacional × Remo" provaria o calendário de um dia e apodreceria no dia seguinte.

O que ele fixa: N-1 terminais nunca fecha (testadas **todas** as N posições do jogo que falta);
N terminais fecha; todo estado não-terminal (agendado, ao vivo, intervalo, suspenso, adiado,
cancelado, ausente da fonte) barra o fechamento; a ordem do array não decide nada (25
embaralhamentos, mesmo veredito); o relógio não substitui o status; scoring/ranking finalizados
antes da notificação; exatamente um e-mail por destinatário; retentativa parcial toca só quem
falhou; ACEITO e INCERTO nunca reenviam; replay e flap terminal→ao vivo→terminal não reenviam.

**Oito mutações, todas pegas.** Duas delas só mordem na camada certa, e isso está registrado no
próprio arquivo: numa rodada já `SENT` o portão de `claim` recusa antes de a seleção por
destinatário importar — então a mutação do dedupe precisa de uma rodada `PARTIAL`, e a de
`UNCERTAIN` precisa ser exercitada na função pura `alvos_reenviaveis()`, porque a rodada com
incerto assenta em `NEEDS_MANUAL_REVIEW`, que não é reivindicável. São duas camadas
independentes protegendo o mesmo dado; mirar a de fora esconde a de dentro.

## v1.122 — 2026-08-16

### O hero ao vivo mostra TODOS os jogos simultâneos, não só o primeiro

Numa rodada com dois ou três jogos ao mesmo tempo — o normal num domingo de Brasileirão — o card
ao vivo mostrava **um**.

**Causa raiz, e é uma regressão de uma correção.** `5b66389e` ("hero ao vivo sobrevive a falha
transitória da fonte") introduziu a camada de retenção, que existe para impedir que uma falha
passageira da fonte apague da tela um jogo em andamento. `resolveFeaturedMatchState()` é, por
contrato, de **uma** partida: recebe `observed`, devolve `match`. Para encaixar o conjunto nesse
contrato, o seletor virou `_liveMatches[0]` e o resultado voltou embrulhado em `[resolved.match]`.

O renderizador nunca foi de uma partida só — `heroMatches.map(...)`, o cabeçalho
`heroMatches.length > 1`, a chave i18n `liveMatchesLabel` e o `.live-match-grid` (`flex-wrap`, os
cards lado a lado) já estavam prontos desde a v1.43. Uma correção de robustez estreitou a entrada
de um renderizador que já era múltiplo, e o que ficou foi meio recurso ligado.

**Correção:** a retenção passa a ser **por partida**, não uma vaga só. `resolveLiveHeroMatches()`
resolve o conjunto união de "ao vivo agora" e "retido do último confirmado", partida a partida, e
devolve todas as que continuam no ar. O invariante da retenção ("ausência de evidência nova não é
evidência de que a partida acabou") passa a valer para cada jogo, em vez de valer para o primeiro
e apagar os outros.

Junto vieram três coisas que o conjunto exigiu e a vaga única escondia:

- **Terminal por partida.** `_liveMatches` só carrega o que está ao vivo, então um jogo que acaba
  simplesmente some dela — e "sumiu" é exatamente o sinal que a retenção ignora. Sem observar o
  terminal, um jogo encerrado ficaria no hero até o TTL de 15 min expirar. `_terminalPorId`
  alimenta o `terminalForRetained` que o resolvedor já aceitava e ninguém passava.
- **Ordem determinística.** Os cards seguem o horário de início (ascendente), com o id como
  desempate estável. Antes a ordem era a da resposta da fonte, que pode mudar entre dois polls.
  `kickoff` passou a ser carregado no mapeamento **apenas para ordenar** — não participa de
  nenhuma classificação de estado.
- **Marca de atraso por partida.** Num conjunto simultâneo um jogo pode estar retido enquanto
  outro acabou de ser confirmado; marcar os dois como atrasados seria mentir sobre o observado.

O hero do **ranking provisório** tinha a mesma condição (`_liveMatches[0]`) e sumia quando o
primeiro jogo da lista terminava e outro seguia ao vivo — no meio da rodada, que é justamente
quando ele serve. Passou a usar a mesma resolução.

**Nada de definição de "ao vivo" mudou:** quem classifica continua sendo `isLiveMatch()`, e
`_liveMatches` já era a lista completa. Nenhuma mudança de CSS foi necessária — o grid já era
`flex-wrap`.

**Prova:** `bolao/scripts/audit_multi_live_hero.mjs` (28 asserções) exercita 0/1/2/3/4 jogos
simultâneos e as transições 0→1→2→3→2→1→0 no app real, comparando as **identidades** das partidas
no DOM com as dos dados — contar cards deixaria passar o card errado repetido. Um jogo encerrado
no mesmo payload não pode entrar. Reintroduzir o seletor de primeiro-jogo-só deixa **7 asserções
vermelhas**. `audit_multi_live_hero_responsive.mjs` (72 asserções) mede geometria real em
1440x900, 1024x768, 768x1024 e 390x844 com 1/2/3 jogos: zero overflow horizontal de página, zero
sobreposição, placar/relógio/nomes visíveis em todos os cards.

`SCORING_CHANGED = NO` · `RANKING_CHANGED = NO` · `RESULT_INGESTION_CHANGED = NO` ·
`SUPABASE_CHANGED = NO` · `EMAILS_SENT = 0` · `PARTICIPANTS_MUTATED = 0`.

## v1.121 — 2026-08-16

### Tabela: a coluna TIME deixou de engolir a largura sobrando no desktop

Eduardo, no desktop: "enorme área vazia entre TIME e PTS". A tabela aparecia partida em dois
blocos — `# / MOV. / TIME` à esquerda, `PTS / J / V / E / D / GP / GC / SG` colada na direita, com
506px de vazio no meio a 1440 e a 1728.

**Causa raiz.** `.td-team` estava declarada `display: flex`. Um `<td>`/`<th>` que não é
`display: table-cell` **deixa de ser célula**: a tabela gera uma célula ANÔNIMA em volta dele, e é
essa célula anônima que o algoritmo de colunas dimensiona. A anônima não tinha largura declarada,
então sob `table-layout: fixed` ela era a única coluna `auto` da tabela e absorvia toda a largura
que sobrava, enquanto a caixa flex de 220px ficava alinhada à esquerda dentro dela. O vazio era o
resto daquela célula.

O mesmo defeito rodava ao contrário no mobile, onde ninguém tinha percebido: como as larguras
declaradas já excediam a caixa da tabela, a coluna anônima colapsava para **0px** e as células
sticky só *pareciam* certas porque seus fundos opacos pintavam por cima das colunas que estavam
invadindo — a 390px, J/V/E/D ficavam inalcançáveis (depois de PTS vinha GP). Corrigido junto: a
ordem natural J/V/E/D/GP/GC/SG voltou a valer no scroll horizontal.

**Correção.**

- `.td-team` volta a ser célula de verdade. O alinhamento nome+selo que o flex dava agora vem de
  `vertical-align` nos dois filhos inline-block, com `nowrap`/`overflow` na célula.
- Todas as larguras de coluna, a largura da própria tabela e **todos** os offsets `left` das
  colunas sticky passam a derivar de um único conjunto de tokens (`--col-pos`, `--col-mov`,
  `--col-team`, `--col-pts`, `--col-stat`, `--col-team-name`). Os offsets sticky eram somas
  hard-coded (72px/200px/292px) das larguras declaradas — foi exatamente esse acoplamento manual
  que produziu o bug de 2026-07-25 ("ta truncando o numero de jogos"). Agora não há como uma
  coluna ser declarada com uma largura e desenhada com outra.
- A tabela tem a largura das suas colunas (`width: calc(...)`), não `width: 100%`. No desktop isso
  dá 648px compactos dentro do card; abaixo de 900px dá 468px, mais largo que `.standings-wrap` —
  que é precisamente o scroll horizontal contido que as colunas sticky existem para servir.
- Desktop (≥900px) só sobrescreve tokens: TIME 240px (190px de nome, o suficiente para "Athletico
  Paranaense" e "Red Bull Bragantino" sem reticências), Pts 56px em destaque, estatísticas 40px.

### Faixas G4/SA/Z4: a linha voltou a ter UMA cor só

Achado durante a correção acima, no mesmo componente. As 4 células sticky pintavam sólidos
escolhidos à mão (`#0d1f14` / `#1f1414` / `#1f1a0d`) que **não** batiam com o tom translúcido que
as outras 7 células mostravam — uma linha Z4 era `rgb(31,20,20)` sob `# / MOV. / TIME / PTS` e
`rgb(29,38,45)` sob `J..SG`. Cada linha de faixa lia como dois blocos descolados.

Agora o tom de cada faixa é declarado uma única vez (`--zone-tint`) e as células sticky o compõem
sobre `--bg2` via `background-image`, chegando ao mesmo pixel das células translúcidas por
construção. Os sólidos hard-coded foram removidos.

### Regressão

Novo: `bolao/br2026/scripts/visual/check_standings_layout.mjs` (entra em `npm run test:node`).
Mede caixas de layout reais em 8 viewports (320→1728) e checa contiguidade das colunas,
alinhamento header/corpo, ordem PTS<J<V<E<D<GP<GC<SG, limites da tabela, largura da coluna TIME,
ausência de overflow horizontal na página, os offsets sticky sob scroll máximo, e — com pixels
amostrados de verdade — a continuidade de cor da linha de faixa.

Mutação verificada: reintroduzir `display: flex` + `width: 100%` deixa o teste VERMELHO com o
vazio TIME → PTS medido (418px a 1440/1728, 302px a 1024); reintroduzir os sólidos de faixa
deixa VERMELHO no teste de cor.

Escopo: só CSS de apresentação do BR2026 + o teste novo. Scoring, dados, Supabase, e-mail, admin e
regras de torneio não foram tocados; as três auditorias de scoring continuam passando.

**Propagação: não se aplica.** `.standings-table` existe só no BR2026 — a Copa e a CDB não têm
tabela de classificação (mata-mata), e `.rules-table`/`.live-ranking-table` não compartilham
nenhuma destas regras. Nenhum arquivo de `bolao/shared/css/` foi tocado. Auditado mesmo assim nos
outros apps: `audit_visual_consistency` DIVERGENT=0 e `audit_responsive_matrix` sem overflow em 15
larguras (320→1600) nos quatro produtos.


## v1.120 — 2026-08-13

### READ_CUTOVER — a leitura passa a vir do modelo normalizado (segunda execucao)

`readTable` sai de `bolao_state_public` e passa para `bolao_state_normalized_public`.

A primeira execucao (2026-08-13, v1.118) foi revertida em 24s porque o comparador do log de
auditoria estourava quando o documento remoto nao publica `auditLog` — defeito latente, exposto
pela rota nova, corrigido em v1.119 e verificado em navegador real na rota LEGADA antes desta
troca. Ver a entrada de v1.119.

Gates desta execucao: paridade folha a folha 0 BUG / 0 UNKNOWN nos tres produtos; selo de pago
identico; `deletedIds` identico como conjunto; as tres auditorias de scoring passam; PII publica 0;
`bolao_state` cru negado ao anon em leitura e escrita.

**A ESCRITA NAO MUDOU.** O documento legado continua sendo a autoridade. Reverter e trocar
`readTable` de volta — provado ao vivo em 24s.


## v1.119 — 2026-08-13

### O comparador do log de auditoria aceita as DUAS formas de registro que o banco grava

Um registro de auditoria carrega o instante do evento em `ts` OU em `at`, e as duas formas sao
legitimas e estao gravadas hoje:

| Forma | Quem grava | Campos |
|---|---|---|
| A | `appendAudit()` no navegador e `public._bolao_audit()` | `ts, action, admin, detail` |
| B | `public.cdb_apply_operator_mutation()` | `type, actor, at, clientRef, payload, source` |

Medido na producao em 2026-08-13: o cdb2026 tem 42 registros, 28 da forma A e 14 da forma B;
br2026 e copa2026 tem 7 e 19, so da forma A. Nenhum registro traz os dois campos.

O merge lia apenas `.ts`. Isso produzia DOIS defeitos com a mesma raiz:

1. **A chave do Map.** `auditMap.set(entry.ts, entry)` com `ts` indefinido faz TODOS os registros
   da forma B colapsarem numa unica entrada `undefined`. Na producao do cdb2026 isso reduzia 42
   registros a 29 — treze registros de auditoria desapareciam do log em toda carga.
2. **O sort.** `b.ts.localeCompare(a.ts)` estoura quando `b` nao tem `ts`. Nao estourava sempre:
   depende de ONDE o registro sem data cai no array que o V8 ordena. Varrendo todas as posicoes,
   estourava em n-1 de n — a unica posicao que sobrevivia era exatamente a que a producao tinha,
   que e por isso que a rota legada parecia sadia e o canary da rota normalizada nao.

Correcao: dois acessores minusculos, identicos nos tres apps para que nao voltem a divergir.
`auditStamp()` le `ts` ou `at` e devolve `""` quando nao ha instante — um registro sem data nunca
e o mais novo, e nenhum instante e inventado para ele. `auditKey()` deduplica por
`(instante, clientRef)`: o `at` do servidor tem resolucao de segundo inteiro e dez dos catorze
registros dividem apenas DOIS instantes, entao o instante sozinho nao identifica o evento. A forma
A nao tem `clientRef`, logo para ela a chave continua sendo exatamente o instante — comportamento
inalterado. Resultado medido contra a producao: cdb2026 passa de 29 para **42/42** registros
preservados; copa2026 e br2026 seguem em 19/19 e 7/7.

O renderizador do painel de auditoria recebeu a mesma tolerancia do cdb2026, ainda que o br2026
nao tenha hoje nenhum gravador da forma B: manter os tres renderizadores identicos e o que impede
que este mesmo ponto volte a divergir entre os apps.


### O que NAO mudou

A rota de leitura continua `bolao_state_public`. Este release muda comportamento de comparador, e
nada mais — o merge de entradas (`updatedAt || createdAt`) esta byte a byte identico ao anterior e
foi reexercitado contra a matriz de estado velho/novo. Scoring intocado, as tres auditorias passam.


## v1.118 — 2026-08-13

### READ_CUTOVER — a leitura passa a vir do modelo normalizado

`readTable` sai de `bolao_state_public` e passa para `bolao_state_normalized_public`.

O documento antigo era sanitizado por SUBTRACAO: removia quatro campos de pagamento e deixava
passar todo o resto, entao tudo que foi acrescentado depois virou publico por padrao — inclusive
`auditLog` (ip, userAgent, platform, screen) e `entries[].diagnostics` (userAgent, timezone,
viewport). A superficie nova NOMEIA cada campo que emite, entao o padrao se inverte: campo novo e
privado ate alguem publica-lo de proposito. Esses dois saem do contrato publico.

Equivalencia verificada folha a folha contra a saida legada real: 0 BUG e 0 UNKNOWN nos tres
produtos. Selo de pago identico. `deletedIds` identico como conjunto.

**A ESCRITA NAO MUDOU.** O documento legado continua sendo a autoridade de escrita. O modelo
normalizado recebe espelhos atomicos na MESMA transacao — palpite salvo, cutoff de fase, kickoff e
topologia — provados contra re-drift executando as operacoes reais de sync e save num banco
descartavel. Reverter e trocar `readTable` de volta.

## v1.117 — 2026-08-10 — O navegador deixa de receber PII e de reescrever o estado (F10/N22)

Duas mudanças de segurança, feitas juntas porque separá-las abriria uma janela.

**Leitura.** O app lê `bolao_state_public`, uma projeção que remove `participantEmail`,
`payerName`, `paymentMethod` e `paymentTo` de cada entrada. Medido no navegador real: 11 entradas
carregadas com apenas `id`, `entryName`, `picks`, `createdAt`. Os 46 e-mails da plataforma
deixaram de ser anonimamente enumeráveis por este app.

**Escrita.** `saveRemoteState()` foi removida. Ela fazia POST do documento JSON **inteiro** com
`merge-duplicates` — e a anon key vai neste mesmo `js/config.js`, servido a todo navegador. Quem
tivesse a chave podia reescrever entradas, pagamentos, resultados e estado de notificação de uma
vez só.

Agora a submissão pública chama `submit_entry`, uma RPC que valida competição, nome, e-mail,
forma dos palpites, método de pagamento e prazo — e **atribui o id**. A entrada é montada campo a
campo no servidor, então `paid`, `results` e `officialDraw` não têm por onde entrar. `clientRef`
torna o reenvio idempotente: clicar duas vezes devolve a mesma entrada, e a tela diz isso em vez
de fingir um cadastro novo.

**As cinco operações de administrador saíram do navegador.** Marcar/desmarcar pago, travar/
destravar resultados e excluir entrada não gravam mais daqui — o controle continua visível para
não esconder o estado, mas avisa para onde a operação foi. O substituto é
`scripts/operator_cli.py`, com dry-run por padrão, diff sem PII, validação, log de auditoria e
saída não-zero em falha. `confirm-payment` e `unconfirm-payment` são comandos separados de
propósito: um booleano vindo de texto ambíguo é como se marca a pessoa errada.

Provado em produção: dry-run das cinco operações sem mutar nada; `--apply` de ida e volta num
pagamento real **sem nenhuma chave divergente** fora de `meta.updatedAt` e `auditLog`; duas
submissões simultâneas criam duas entradas sem perder nenhuma; o mesmo `clientRef` não duplica.

Três gates existentes mudaram de lugar, não de rigor — `audit_remote_write_visibility`,
`audit_test_isolation` e a checagem de carimbo de atualização exigiam a forma antiga do upsert.
Exigi-la seria exigir de volta a vulnerabilidade removida. O carimbo agora é do **servidor**, o
que é mais forte: o cliente não pode mais mentir sobre o instante.

## v1.116 — 2026-08-10 — O ledger de notificação vira atômico no banco (F7)

A migração `010_notification_durability.sql` foi **aplicada em produção**. O ledger de rodada
deixou de viver em `bolao_state.roundEmail.ledger` (JSON, read-modify-write) e passou a ser
`bolao_notif_jobs`, com claim atômico via `for update skip locked` dentro da RPC.

Verificado contra o banco real, não contra o texto do SQL: RLS habilitada com **zero policies**,
`anon` não lê nem escreve, nenhuma coluna de contato, unicidade de idempotência, campos de lease,
`provider_message_id`, `schema_version`, 7 RPCs `security definer`.

**Um detalhe que quase passou:** `SELECT`, `UPDATE` e `DELETE` anônimos devolvem `200`/`204` na
tabela nova — mas isso é o PostgREST dizendo "zero linhas casaram", porque a RLS torna tudo
invisível. Provado criando um job pela RPC, tentando alterá-lo e apagá-lo como `anon`, e
confirmando que ele sobreviveu intacto. Ler código de status como se fosse resultado foi
exatamente o erro que causou o incidente do F8 horas antes.

**Defeito real encontrado na 010 ao executá-la:** `release_expired_bolao_notif` nunca funcionou —
o `CASE` devolve `text` e a coluna é do enum `bolao_notif_status`, sem conversão implícita. Toda
chamada falhava com `42804`. O impacto seria silencioso: jobs cujo runner morreu ficariam presos
em `processing` para sempre, porque a única rotina que os liberaria não roda. Corrigido na `014`.
Os testes de contrato liam o texto do SQL e não podiam pegar isso.

Histórico migrado (`012`): 20 rodadas marcadas como já notificadas, 18 por serem anteriores ao
recurso e 2 por evidência do `sentGameIds`. O JSON legado **permanece intacto** — é a fonte desta
migração e a evidência histórica.

`REAL_SEND_REQUIRES_ATOMIC_LEDGER` agora é operacional: sem o ledger atômico, o envio real
aborta. Ler estado que não conseguimos ler e decidir reenvio a partir disso é como se duplica
e-mail para gente real.

Round 22 segue em dry-run, sem autorização de envio.

## v1.115 — 2026-08-10 — O e-mail de rodada passa a usar o ledger durável de verdade

A plataforma já tinha `notification_repository`, `durable_notification_repository`,
`notification_worker` e a SQL `010_notification_durability.sql` — tudo bem escrito, testado, e com
**zero consumidores em produção**. `grep` por essas classes nos três apps e nos workflows
retornava vazio. Mesma forma do defeito do FootballLiveStore: capacidade implementada, testada e
nunca chamada.

`send_round_email.py` — o ponto de entrada real do cron — agora executa o pipeline canônico:
manifesto versionado (com proveniência oficial) → resolver por rodada → migração do estado legado
como evidência → ledger durável → portão de destinatários → claim com lease.

`get_or_open_batch()` foi **removida**. Era o coração da janela rolante: um `pendingBatch` global
que travou em 29/07 com 4 jogos adiados e escondeu a R22 por 12 dias. Deixá-la como código morto
seria pior que removê-la — ela parece autoritativa.

O `--dry-run` é modo de primeira classe do **mesmo** caminho, não um atalho paralelo: um preview
que roda por outro código não prova nada sobre o código que envia. O workflow do cron passou a
rodar em dry-run, e `BOLAO_ALLOW_REAL_SEND` foi removida do job — duas travas independentes em
vez de uma.

O ledger existe em Node e Python porque o caminho de envio é Python e os gates são Node.
`test_round_ledger_interop.mjs` executa as duas implementações sobre os mesmos casos e falha se
um hash, chave ou transição divergir — este repositório já perdeu essa aposta uma vez, quando
`send_result_email.py` derivou silenciosamente da pontuação do `app.js`.

## v1.114 — 2026-08-10 — BR2026 passa a usar de verdade o store ao vivo compartilhado

`football_live_store.js` era carregado pelo `index.html`, tinha suíte de unidade verde, e os apps
chamavam seus predicados. Tudo isso passava em auditoria — e `createStore()` **nunca era chamado
por app nenhum**. Cada app mantinha a própria hierarquia de fontes, o próprio laço de poll, o
próprio carimbo de observação e a própria saúde de fonte. A biblioteca canônica era decorativa: os
defeitos corrigidos nela (FINAL que regredia para AO VIVO, `stop()` que não parava, cache
envenenado aceito) não protegiam produção nenhuma, porque produção não passava por ela.

Agora existe **uma** autoridade de dado ao vivo. Saíram do `app.js`: `fetchFromGateway()`,
`schedulePoll()`, `_pollChainToken`, `_pollBackoffMs`, `_pollFailed`, `_liveObservedAt`,
`_liveSource` e o fallback de snapshot. O app não decide fonte, não agenda poll ao vivo, não
guarda carimbo de observação e não classifica frescor — consome observações e desenha.

**A classificação continuou separada, de propósito.** A tabela do Brasileirão não é dado de
partida ao vivo: não decide AO VIVO/FINAL/PRE, não alimenta o hero nem o relógio. Empurrá-la para
dentro do store só para reduzir a contagem de timers deixaria a arquitetura menos coesa.
`refreshStandingsOnly()` tem cadência própria de 60s e nunca busca placar.

Comportamento preservado e **provado**, não assumido: a suíte
`audit_br_live_behavior_parity.mjs` foi escrita antes da migração e rodada contra o código
antigo (13/13). Depois da migração ela passa 13/13 **sem uma linha alterada** — primeira visita
no meio do jogo, gateway 500 caindo para snapshot, fonte totalmente indisponível, dado de 20
minutos, FINAL que não regride, retomada de bfcache sem multiplicar timer, classificação, e
nenhuma requisição do navegador para a ESPN.

Três gates existentes precisaram mudar de lugar, não de rigor: `audit_live_decision_scope`,
`audit_live_freshness` e `audit_live_clock` exigiam que o **app** contivesse a consulta ao
gateway, a validação de schema e a âncora de relógio. Exigir isso do app passou a ser exigir a
duplicação que esta mudança elimina — agora eles verificam que o app delega a um store que
comprovadamente faz as três coisas.

## v1.113 — 2026-08-10 — Cache persistido passa a ser tratado como entrada não confiável

O cliente validava `schemaVersion === 1` e `matches !== null`, e aceitava qualquer coisa dentro
de `matches`. Esse número prova apenas que alguém escreveu 1 — e o conteúdo do cache do gateway
é dado persistido, potencialmente gravado por outro caminho e lido muito depois de escrito.

Medido no código anterior, com um payload envenenado de `schemaVersion: 1`, o store devolvia
estado `LIVE_CRITICAL_STALE` e expunha à tela um objeto arbitrário como partida ao vivo —
`completed: "talvez"`, `homeScore: -999`, `statusName` sendo um objeto. Agora o mesmo payload
produz `SOURCE_UNAVAILABLE` com `CACHE_INVALIDO:PARTIDA_INVALIDA[0]: completed nao booleano`.

`validateGatewayBody()` no módulo compartilhado valida versão de schema, competição, forma do
array, id presente e único, `state` dentro do contrato, tipos de `completed`/`postponed`/
`statusName`, faixa de placar e `observedAt` parseável. Cache inválido é rejeitado e provoca
fallback seguro — **nunca** é convertido numa lista vazia de partidas, porque lista vazia
significa "sabemos que não há jogo", afirmação forte e falsa nesse caso. `matches: null` segue
válido: é a fonte declarando que não sabe.

Gate novo `test_cache_poisoning.mjs` (CACHE_POISON_REJECTED): 28 asserções, 23 payloads
envenenados distintos, mais a verificação ponta a ponta pelo store.

Enquanto a escrita anônima em `live_sports_cache` não estiver negada no banco, esta validação é
a barreira no cliente.

## v1.112 — 2026-08-10 — Os arquivos compartilhados estavam fora do cache-bust

Os cinco arquivos locais de cada app (`css/styles.css`, `js/config.js`, `js/data.js`,
`js/i18n.js`, `js/app.js`) recebiam `?v=<hash>`. Os **onze compartilhados** — os três módulos JS
e os oito CSS em `../shared/` — não recebiam nada, e nem sequer entravam no cálculo do hash.

O efeito prático era sério: a correção do `football_live_store.js` publicada horas antes
(FINAL não regride para AO VIVO, `stop()` que realmente para) **não chegaria** a nenhum navegador
que já tivesse o arquivo em cache. Correção commitada, deployada, e invisível no cliente.

Agora os onze entram no hash e recebem tag. Uma mudança em qualquer módulo compartilhado muda o
tag dos três apps — que é a semântica correta, já que os três o consomem. O bot
`sync_version.yml` já chamava exatamente este módulo, então passa a cobrir os compartilhados sem
alteração no workflow.

Gates novos em `cachebust.integration.test.mjs`: `SHARED_ASSET_CHANGE_INVALIDATES_CACHE` (mexer
só num módulo compartilhado tem de mudar o tag e reescrever o HTML) e uma guarda contra
regressão por omissão, que varre os três `index.html` reais e falha se qualquer referência a
`../shared/` estiver sem `?v=`. Provado falhando contra o estado anterior.

## v1.111 — 2026-08-10 — Proveniência oficial: a partição prova integridade, não identidade

O manifesto da v1.110 agrupava as rodadas por partição round-robin dos 20 clubes. Isso prova que
o agrupamento é **consistente** — não prova que o bloco k é a rodada k. Um deslocamento uniforme
de ±1 satisfaz a partição perfeitamente e atribui a rodada errada aos 380 jogos. E o número da
rodada vai no assunto de um email para 11 pessoas.

Regra agora explícita no manifesto: **atribuição oficial = verdade de negócio**; partição
round-robin = validador de integridade; ordem de id de evento = auxílio de implementação;
datas = metadado.

Três âncoras verificadas contra fonte oficial e citadas no manifesto:
Flamengo 2×0 Vitória, 09/08, Maracanã = **22ª rodada** (FFERJ, Exame);
Corinthians 0×0 Athletico-PR, 30/07 = **21ª rodada**; Coritiba 0×1 Cruzeiro, 31/07, Couto
Pereira = **21ª rodada**. As três concordam com a partição gerada.

Corroboração adicional e independente do adiamento: a fonte oficial registra que quatro jogos da
21ª rodada foram adiados pela participação de Santos, Red Bull Bragantino, Vasco e Grêmio nos
playoffs da Sul-Americana — exatamente os quatro clubes dos jogos que o upstream marca
`STATUS_POSTPONED`. Confirma o número da rodada e a causa do travamento.

O validador agora falha com `CONFLITO DE PROVENIENCIA` se manifesto e fonte oficial discordarem,
e recusa manifesto sem âncora ou com âncora sem fonte citada. Provado contra um deslocamento
uniforme de +1: 3 conflitos detectados com a partição intacta.

## v1.110 — 2026-08-10 — Rodada canônica: a R21 adiada deixa de esconder a R22

A rodada que terminou em 09/08 não recebeu email. A investigação mostrou que nenhuma rodada
receberia: o modelo antigo mantinha UM `pendingBatch` global definido por janela de datas, e o
lote aberto em 29/07 continha 4 jogos adiados indefinidamente. Como só fechava com
`all(completed)`, travou — e por ser único e global, impediu que qualquer rodada posterior fosse
sequer avaliada.

**Identidade canônica de rodada.** Novo `data/round_manifest.json`, versionado, 38 rodadas, 380
jogos. A pertinência não vem de proximidade de datas: vem da propriedade estrutural de que uma
rodada é uma partição dos 20 clubes em 10 jogos, cada clube exatamente uma vez. O gerador
(`build_round_manifest.py`) rejeita qualquer bloco que não satisfaça a partição — foi assim que
descobrimos que ordenar por data embaralha 26 dos 38 blocos, e que a ordem correta é a do id de
evento. Datas ficaram como metadado.

**Adiado pertence para sempre à rodada de origem.** Dois jogos da R4 adiados em 25/02 e
rejogados em julho com ids novos: o manifesto mapeia `replacements`, e o rejogo satisfaz o jogo
canônico sem migrar de rodada.

**Cada rodada tem seu próprio ciclo de vida.** `round_state.py` é um resolver puro com dez
estados. A R21 fica em `ROUND_WAITING_FOR_POSTPONED_MATCH` e a R22 fica
`ROUND_READY_TO_NOTIFY` de forma independente. Fonte indisponível e jogo ausente nunca viram
completo.

**Reconciliação, não observação de transição.** Não é mais preciso estar rodando no instante em
que a rodada termina: cron perdido, runner fora do ar ou provedor caído são recuperados na
execução seguinte, porque o estado é derivado dos fatos.

**Migração do estado legado.** `legacy_round_state.py` traduz `sentGameIds`/`sentBatches` para
chaves de idempotência por rodada — sem isso o primeiro catch-up reenviaria rodadas já
comunicadas (medido: R17–R20 apareceram como candidatas). O `pendingBatch` travado virou
evidência histórica, não trava. Rodadas anteriores ao recurso ficam fora do escopo por epoch.

Dry-run real contra produção: candidatos = [22], exatamente uma rodada. Nenhum email enviado.
Gates novos: `test_round_state.py` (26 asserções). Nada foi enviado nesta versão.

## v1.109 — 2026-08-10 — Email de rodada: parcial deixa de parecer completo

Três defeitos no caminho de envio de `send_round_email.py`, todos convivendo com a suíte verde
porque nenhum teste exercitava esse caminho.

**Destinatário sumia em silêncio.** Quem não tivesse email válido ou não aparecesse no ranking
era pulado com um `continue` — o email de rodada sairia para 11 de 12 pessoas e o lote seria
fechado como enviado. Agora todo o conjunto é resolvido ANTES da primeira chamada ao provedor:
se um único participante não resolver, ZERO emails saem e o lote fica aberto.

**Envio bloqueado contava como sucesso.** `send_email()` devolve `(False, motivo)` quando o
portão fail-closed bloqueia, sem levantar exceção — e o código somava isso como enviado. Qualquer
execução sem `BOLAO_ALLOW_REAL_SEND` fecharia a rodada sem ninguém receber nada.

**Parcial fechava o lote.** Se metade das entregas falhasse, o lote era fechado assim mesmo e
ninguém jamais reprocessaria. Agora entrega incompleta vira `ROUND_NOTIFICATION_PARTIAL`, o lote
permanece aberto e o resumo ao admin só sai quando a entrega foi de fato completa.

Logs passaram a usar id de entrada em vez de endereço de email. Gate novo
`test_recipient_completeness.py`: 6 asserções sobre a contagem de chamadas ao provedor,
provadas falhando 4/6 contra o código antigo.

## v1.108 — 2026-08-10 — FootballLiveStore: FINAL voltava a AO VIVO, e stop() não parava

Dois defeitos de corrida/ordem no módulo compartilhado, ambos reproduzidos antes da correção.

**FINAL regredia.** `ingest()` aceitava qualquer observação estritamente mais nova. O comentário
no código argumentava que a regra de timestamp bastava — mas ela só protege contra resposta
ATRASADA. O caso real é o oposto: o upstream declara FINAL às 22h05 e, numa observação mais NOVA
às 22h06, volta a declarar `in`. Medido no código antigo: FINAL → LIVE_CRITICAL_STALE, e
FINAL → PRE virava NO_LIVE_MATCH. O hero voltava a dizer AO VIVO num jogo encerrado.
Agora o ciclo de vida terminal por partida não regride, enquanto correção de placar pós-jogo
continua sendo aceita — o fato muda, o ciclo não.

**stop() não parava.** `start()` fazia `refresh().then(schedule)`. Um `stop()` durante o refresh
em voo era ignorado pelo `.then`, que agendava um timer novo depois. Medido: `timers=1` após
stop. Cada start/stop de rerender deixava um laço órfão polindo para sempre. Agora `schedule()` e
o tick verificam `started`, e `stop()` também zera os listeners.

Gate novo `bolao/shared/scripts/test_live_store_lifecycle.mjs` (STOP_DURING_INFLIGHT_REFRESH,
TERMINAL_STATE_NON_REGRESSION) — 8 asserções, provadas falhando 5/8 contra o código antigo.

## v1.107 — 2026-08-10 — Todo `<thead>` da plataforma estava corrompido

Auditoria independente apontou um `<th scope="col"ead>` no repositório. Eram **22**, nos três
apps — e não sobrou nenhum `<thead>` válido: a contagem de `</thead>` batia exatamente com a de
tags corrompidas em cada arquivo.

A causa foi um replace em massa de `<th` para `<th scope="col"`, feito para satisfazer o gate de
acessibilidade, que casou também dentro de `<thead>`. O gate de acessibilidade continuou verde
porque todo `<th>` de fato tinha `scope` — inclusive o que não era um `<th>`. Os validadores de
HTML estático também não viam nada, porque essas tabelas (recibos, ranking, palpites) são montadas
em template literals dentro de `js/app.js`.

Correção: as 22 ocorrências viraram `<thead>` de novo, restaurando o balanceamento exato com os
`</thead>` existentes. Novo gate `bolao/scripts/audit_html_table_structure.mjs` valida o HTML
**gerado**, não só os arquivos `.html`: detecta lixo colado após valor de atributo, exige
balanceamento de `<thead>`/`<tbody>`/`<table>`, mantém a exigência de `scope` em todo `<th>` e
falha se parar de encontrar tabelas (um gate que perde cobertura é falso-verde). Provado contra o
código antigo antes de entrar na suíte. Entrou em `npm run test:node`.

## v1.106 — 2026-08-09 — Gravação remota que não acontece deixa de parecer sucesso

O Eduardo registrou a data do sorteio da CBF pelo painel admin do CDB2026 e a tela confirmou.
Horas depois, o estado canônico no Supabase seguia com `officialDraw: null` — a alteração nunca
saiu do navegador dele, e **nada na interface disse isso**.

Duas falhas independentes, do mesmo formato — silêncio num caminho de gravação:

1. **Caso PULADO não era tratado.** `saveRemoteState()` devolve `{ok:false, skipped:true}` quando
   a gravação remota é bloqueada (isolamento de teste) ou desligada. Isso **resolve** a promessa;
   o chamador só tinha `.catch()`, então o caso passava direto e a tela mostrava "salvo".
2. **BR2026 estava pior:** `.catch(() => {})` engolia até erro real, e `saveRemoteState()` não
   checava `r.ok` — um 401/403 do RLS era tratado como sucesso. A correção equivalente existia no
   CDB2026 desde a auditoria de 2026-08 (AUDIT-04) e nunca foi propagada. É o app que movimenta
   pagamento.

Agora os dois casos são visíveis, com mensagens distintas: `syncBlocked` ("salvo neste dispositivo,
mas NÃO sincronizado — ninguém mais vai ver") e `syncFailed`.

**Bônus de diagnóstico:** o upsert passou a gravar `updated_at`. A coluna existia e o app nunca a
escrevia, então ficava congelada na criação da linha — durante este próprio incidente ela dizia
14/07 enquanto o conteúdo tinha dados de 01/08, e a única pergunta que importava ("quando o estado
canônico mudou pela última vez?") não tinha resposta confiável.

O portão de isolamento de produção continua fail-closed: a correção torna o bloqueio **visível**,
nunca mais permissivo.

**Gate permanente:** `bolao/scripts/audit_remote_write_visibility.mjs` (13 checagens), incluindo o
registro explícito de por que a Copa2026 (arquivada) fica de fora — e uma assertiva que falha se
ela deixar de estar arquivada, para a exceção não sobreviver ao motivo dela.

## v1.104 — 2026-08-09 — Relógio ao vivo: dado velho congela o minuto, nunca o apaga

Print de produção do Eduardo: card do Cruzeiro 1 × 1 Mirassol marcado **AO VIVO**, feed de lances
com 48', 27', 26' — e no centro, onde deveria estar o minuto, "Atualização pendente". A tela sabia
que o jogo estava ao vivo, sabia o placar, sabia os lances, e mesmo assim não dizia o minuto que
ela própria acabara de exibir no feed.

**Causa raiz:** uma correção anterior passando do ponto. O problema original era o relógio disparar
sozinho (interpolar minutos com o relógio local depois que a fonte parava de atualizar). A correção
capou a interpolação — certo — e, passado o teto, **substituiu o relógio inteiro** pela mensagem de
atraso — errado.

São três perguntas diferentes que o código tratava como uma:

- a partida está ao vivo? → a **fonte declara**; não expira com o tempo
- qual o último minuto confirmado? → **fato observado**; também não expira
- há quanto tempo não observamos a fonte? → só **isto** envelhece

"Não sei se ainda é 48'" nunca justificou apagar "a última confirmação foi 48'".

**Correção:** a decisão passou para `bolao/shared/js/live_clock.js` — uma semântica só para os três
apps, com estados explícitos (`LIVE_FRESH`, `LIVE_STALE`, `HALFTIME`, `PENALTIES`, `FINAL`,
`UNKNOWN`). Passado o teto, o minuto **congela no último confirmado** e continua visível; o atraso
vira uma linha secundária discreta abaixo. `UNKNOWN` — a mensagem genérica sozinha — ficou
reservado ao único caso em que ela é honesta: sem minuto confirmado E sem estado declarado.

O relógio local continua proibido de inventar minuto: 15 minutos locais depois de um 48' confirmado
seguem mostrando 48', nunca 63'.

**Gates permanentes (as duas metades, porque uma só não pega este bug):**
- `bolao/scripts/audit_live_clock_semantics.mjs` — 22 checagens: matriz de estados, fronteira exata
  do limiar (teto−1s / teto / teto+1s), intervalo e pênaltis sobrevivendo a dado velho, e a
  reprodução literal do print.
- `bolao/scripts/audit_live_card_dom.mjs` — 54 checagens em navegador real, com snapshot sintético
  interceptado (sem rede, sem gancho de teste em código de produção): o pipeline inteiro, de parse
  a render.

## v1.105 — 2026-08-09 — Separação estrutural entre nome do time e porcentagem

No mesmo print, o rótulo lia "Cru... 16%" com o número quase encostado nas reticências. A separação
vinha só de um espaço no TEXTO — e espaço em texto é a primeira coisa que some quando o nome é
truncado por `text-overflow: ellipsis`, porque as reticências substituem justamente os últimos
caracteres. A separação desaparecia exatamente nos segmentos estreitos, que são os que mais
precisam dela.

Agora quem separa é o `gap` do flex container: não pode ser truncado, não depende do conteúdo, vale
igual em todos os segmentos. O espaço no texto continua no markup apenas para o texto acessível.

Medido em navegador real em 320/375/390/430/899/900/901/1024px: separação ≥ 4px em todo segmento,
porcentagem nunca cortada, todas as barras com a mesma altura, zero overflow horizontal.

## v1.103 — 2026-08-09 — Contador regressivo: fim da célula órfã no mobile

No print do iPhone do Eduardo o contador do próximo jogo aparecia como "00 H" e "12 MIN" numa
linha e **"59 S" sozinho embaixo**, ocupando a região central do card onde deveria estar o placar.

**Causa raiz:** `.count-grid` tinha `grid-template-columns: repeat(2, 1fr)` no mobile — override
local que a Copa (referência visual canônica) nunca teve; ela mantém 4 colunas em qualquer largura.
Com 4 células (D/H/M/S) duas colunas dão 2×2 e parecem propositais. Mas a célula de DIAS some
quando falta menos de um dia: sobram 3, e 3 em duas colunas viram 2 + 1 órfã. **O layout quebrava
exatamente quando o contador mais importa — perto do jogo**, que é por que ninguém tinha visto
antes.

**Correção:** `grid-auto-flow: column` + `grid-auto-columns: 1fr` — o grid passa a ter exatamente
tantas colunas quantas células existirem, sempre numa linha só, com larguras iguais. Fica melhor
que os 4 fixos da Copa, que deixariam um slot vazio quando há 3 células. Medido em Chromium: 320,
390, 414, 768 e 1280px, uma linha em todos, sem estouro de texto.

**Gate permanente:** `bolao/scripts/audit_countdown_layout.mjs` mede quantas LINHAS as células
realmente ocupam, em vez de conferir o CSS — assim pega qualquer regressão futura,
independentemente de como venha escrita. Validado por mutação: reintroduzindo `repeat(2, 1fr)`,
falha com "contador quebrado em 2 linhas (3 células)".

## v1.102 — 2026-08-09 — Barra de probabilidade: espessura uniforme em toda a plataforma

O Eduardo mandou um print do iPhone com barras de altura visivelmente diferente **na mesma tela**.
Medido em Chromium a 390px: 30px, 31px, 44px e 56px — e o mesmo jogo (Bahia×Vasco) renderizava
44px numa seção e 56px em outra.

**Causa raiz:** o limiar que decide manter o nome do time é PERCENTUAL (`pct >= 12`), mas o que
decide se o rótulo CABE é PIXEL. Um segmento de 17% num viewport de 390px tem ~56px — não cabe
"Vasco da Gam… 17%". Com `white-space: normal` no mobile, o rótulo quebrava em três linhas e
esticava a linha inteira, porque `.prob-bars` estava em `height: auto`. Como a largura vem da
probabilidade, cada partida esticava um tanto diferente. A espessura desigual era **sintoma de um
limiar medido na unidade errada**, não um problema de altura.

**Correção:** nome e porcentagem viraram elementos separados (`.prob-bar__name` / `.prob-bar__pct`).
A porcentagem tem `flex: none` e nunca encolhe nem quebra; o nome tem `min-width: 0` e encolhe com
reticências até sumir. Com isso o rótulo não pode mais crescer em altura, e a altura voltou a ser
FIXA no mobile — resolvendo o dilema que a quebra de linha da Fase 7 tentava resolver, sem
reintroduzir o corte de texto que a motivou.

Nada de scoring, regra de torneio ou probabilidade foi tocado — só a montagem do rótulo e o CSS.

**Gate permanente:** `bolao/scripts/audit_prob_bar_geometry.mjs` mede os 3 apps em 3 viewports e
trava DUAS propriedades ao mesmo tempo — toda barra com a mesma altura E a porcentagem nunca
cortada. Travar só a altura deixaria passar a "correção" preguiçosa de esconder o rótulo de todo
mundo, que também igualaria as alturas e seria uma piora.

## v1.101 — 2026-08-09 — Relógio ao vivo fail-closed: número congelado deixa de parecer ao vivo

O teto de interpolação já impedia o relógio de disparar quando o dado ficava velho. Mas **capar não
é o mesmo que ser honesto**: passado o teto, a tela continuava exibindo um minuto congelado que
*parece* ao vivo — e era exatamente esse o sintoma relatado ("relógio parado").

Agora, quando a observação é velha demais para PROVAR o minuto atual, a tela diz
**"Atualização pendente"** em vez de um número inventado.

Intervalo, pênaltis e relógio pausado continuam sendo exibidos mesmo com dado velho: são estados
DECLARADOS pela fonte, não valores que o tempo invalida. A distinção importa — tratá-los como
"stale" esconderia informação verdadeira.

Matriz de testes determinística nos dois apps: 45' do 1º tempo · intervalo com dado velho · 2º
tempo · 90' com dado fresco · pausado congela sem virar stale · fail-closed acima do teto · logo
abaixo do teto ainda mostra o relógio (não é agressivo demais) · pênaltis preservados.

## v1.100 — 2026-08-08 — O relógio ao vivo congelava PORQUE o poll estava funcionando

Eduardo, com print: *"Relógio e placar ainda estáticos, isso estava funcionando 100% na cdb essa
semana porém quebrou novamente."*

O modelo de relógio foi escrito quando o navegador falava DIRETO com a ESPN. Ali "buscar" e
"observar" eram o mesmo instante, então ancorar a interpolação na hora do fetch estava certo. Depois
da migração o navegador passou a ler um snapshot que pode ter sido gerado minutos antes — e a
premissa deixou de valer sem que uma linha do relógio mudasse.

A consequência é contraintuitiva: buscando o MESMO snapshot duas vezes, `clockSeconds` não muda.
Com a âncora na hora do fetch, `detectClockPaused()` comparava 60 s de tempo real contra 0 s de
relógio e concluía — coerentemente — que o jogo estava PARADO. Aí `liveClockDisplay()` parava de
interpolar. **O relógio congelava exatamente porque o poll estava funcionando.**

Correção: ancorar em `observedAt`, que é o `generatedAt` do snapshot. Dois polls do mesmo snapshot
passam a dar o mesmo instante de observação — `realElapsed` é 0, nada é declarado pausado, e o
relógio corre continuamente a partir da observação real. O teto de interpolação continua impedindo
que um snapshot velho faça o relógio disparar.

`bolao/scripts/audit_live_clock.test.mjs` (10 checagens) cobre os dois apps e, principalmente,
garante que a correção NÃO cegou a detecção real de intervalo/paralisação.

## v1.99 — 2026-08-08 — Relógio, placar e lances ao vivo voltam a atualizar sozinhos

Eduardo, com jogo acontecendo: *"o hero ao vivo tá com o relógio parado e o placar não atualiza
automaticamente e nem os lances do jogo aparecem (gol cartão substituição), isso tudo existia e
funcionava"*.

**TRÊS sintomas, UMA causa.** Antes da migração da ESPN o navegador chamava a API da ESPN, que manda
`cache-control: max-age=1`. Depois da migração ele passou a ler um arquivo estático servido pelo
GitHub Pages com `cache-control: max-age=600`. O laço de poll continuou rodando a cada 60 s — e
relendo a MESMA cópia em cache por até dez minutos.

Por isso o relógio congelava, o placar ficava velho, e os lances não apareciam: eles estavam no
snapshot mais novo que o navegador simplesmente não buscava.

O dado sempre esteve correto — o normalizador preserva `details` (gol, cartão, jogador, minuto),
verificado no arquivo real. Faltava o navegador chegar até ele.

Os fetches de snapshot passam a usar `cache: "no-cache"` (revalidar), e não `no-store`: o arquivo
tem ~900 KB e só muda quando o cron commita, então revalidar devolve 304 barato na maioria dos
polls e 200 com dado novo quando há novidade.

`bolao/scripts/audit_live_freshness.test.mjs` (6 checagens) trava isso, com controle negativo: o
teste falha se alguém remover a revalidação. Existe porque o sintoma só aparece durante um jogo ao
vivo, em produção, depois de dez minutos — ninguém notaria a tempo de novo.

## v1.98 — 2026-08-08 — `<th scope="col">` em todas as tabelas renderizadas

Cabeçalho de tabela sem `scope` deixa o leitor de tela sem a associação entre célula e cabeçalho:
numa tabela de ranking ou classificação, a pessoa ouve os números sem saber de que coluna são.

Encontrado pela suíte de acessibilidade dos quatro apps — e vale registrar COMO: a tabela do
ranking ao vivo do BR2026 só existe no DOM quando há jogo ao vivo, e não havia jogo ao vivo em
lugar nenhum porque o snapshot da ESPN estava congelado. Assim que o snapshot voltou a ser
publicado, a tabela apareceu e o defeito com ela. Um bug estava escondendo o outro.

Todas as tabelas destes apps têm cabeçalho só na primeira linha (nenhuma tem cabeçalho de linha),
então `scope="col"` é o valor correto em todas.

## v1.97 — 2026-08-08 — Invariantes de estado: nenhum campo de topo se perde no merge

**SEGUNDO DEFEITO REAL, encontrado no estado de PRODUÇÃO durante a verificação:** o campo
`roundEmail` — escrito pelo CRON (`scripts/send_round_email.py`, direto no Supabase) e contendo
`pendingBatch`/`baseline`/`sentGameIds`/`sentBatches` — nunca esteve na lista de campos que o
`mergeStates()` do NAVEGADOR reconstruía. Ou seja: qualquer participante que abrisse a página e
salvasse devolvia ao Supabase um estado SEM ele.

`sentGameIds`/`sentBatches` são o registro de IDEMPOTÊNCIA do envio. Perdê-lo significa poder
REENVIAR email de rodada já enviado a participantes reais; perder `baseline` significa calcular
movimento de ranking contra referência errada. Defeito entre dois escritores (cron e navegador) que
nenhum teste de um caminho só enxergaria. A base por spread fecha isso, e há teste de regressão
específico com o formato real do campo.

**DEFEITO REAL DE DINHEIRO, corrigido aqui:** o merge de `paid` era um spread
(`{...remote.paid, ...local.paid}`), ou seja "local sempre vence". Um `false` local VELHO
sobrescrevia um `true` remoto mais NOVO do admin — o navegador de um participante que abriu a
página antes do pagamento ser confirmado revertia a confirmação ao salvar.

Este é o AUDIT-02. O `PROJECT_MEMORY.md` já DESCREVIA o merge da plataforma como any-true-wins, a
Copa já implementava assim de verdade e o CDB2026 foi corrigido na época. O BR2026 ficou para trás e
ninguém notou, porque a regra estava escrita na documentação e não em um teste. Agora está nos dois.

**Classe de defeito com histórico, não precaução teórica.** O mesmo erro apareceu QUATRO vezes no
CDB2026: o objeto devolvido por `mergeStates()` era montado ENUMERANDO campos, então um campo novo,
ausente da lista, era descartado em silêncio a cada merge — flags de `espnSync` (AUDIT-01),
`cutoffOffsetMs`, e `officialDraw` duas vezes. Nada falhava; o dado evaporava.

Copa2026 e BR2026 nunca tinham sido auditados para isso e tinham exatamente a mesma forma de código.
A base do retorno passa a ser um SPREAD das duas entradas. Todos os campos conhecidos continuam
resolvidos explicitamente e sobrescrevem o spread, então o comportamento de tudo que existe hoje é
IDÊNTICO — o spread só decide o destino de campo que ninguém enumerou.

`bolao/scripts/audit_state_invariants.mjs` (18 checagens, nos três apps) prova a PROPRIEDADE, não a
lista: inventa um campo de topo que o código não conhece e exige que ele sobreviva. Também executa a
matriz de autoridade que antes só existia como comentário — `paid` any-true-wins, `deletedIds` união
(exclusão nunca ressuscita), `cutoffAt` sempre o mais tarde, `officialDraw`/`topology`/
`cutoffOffsetMs` por fase, flags "roda uma vez" por OR — e tem um teste de contrato que falha se
algum `mergeStates()` voltar a enumerar campos à mão.

## v1.96 — 2026-08-07 — Centavos só quando existem de verdade

Eduardo: "os centavos continuam aparecendo, só deve aparecer no prêmio final".

`usd()` passa a omitir `.00` em valor inteiro e manter 2 casas só quando há centavo quebrado:

    $0 · $5 · $60 · $115 · $1,250        (inteiros, sem centavos)
    $80.50 · $11.50 · $1,250.50          (centavos reais preservados)

O prêmio final é exatamente o valor que cai em centavo quebrado (70% do pote), então "sumir com o
`.00`" atende o pedido sem inventar um formatador por contexto — que teria voltado a espalhar regra de
formatação pelo código, o problema que o Batch 5 resolveu.

É também o comportamento que a Copa tinha originalmente (`toFixed(2).replace(/\.00$/, "")`), agora
promovido a regra canônica dos três runtimes e coberto pelo teste de interop.

## v1.95 — 2026-08-07 — Símbolo dos valores volta a `$` (decisão revisada)

Eduardo, depois de ver o `US$ ` em produção: "agora mostra US$ ao invés de $ em todos os sites".
Decisão revisada — os **valores formatados** voltam a `$`: `$5.00`, `$1,250.00`, `$856M`.

Toda a infraestrutura do Batch 5 continua valendo: um formatador canônico por runtime, paridade
navegador/Node/Python garantida pelo teste de interop, e arredondamento half-up explícito. Só o
prefixo mudou — em UM lugar por runtime, que era exatamente o objetivo de centralizar.

**Divergência DELIBERADA, registrada a pedido dele:** a prose do i18n ("Valor: US$ 5 por entrada",
presente desde 2026-07-11) continua com `US$` e **sem centavos** — escolha explícita do Eduardo
("prose sem centavos, valores com"). Então numa mesma tela a frase diz `US$ 5` e o valor calculado
diz `$60.00`. Isto é intencional; não "unificar" por conta própria numa próxima passada.

Também revertida a linha de taxa de entrada do CDB2026 para prose (`Entrada: US$ 5.`) em vez da saída
do formatador — ela é frase, não valor calculado.

E corrigida uma inconsistência de espaçamento que existia antes de tudo isto: o Powerball mostrava
`US$10 cada` (sem espaço) contra `US$ 5 por entrada` dos três bolões. Agora `US$ 10 cada`.

Verificado em browser nos quatro apps: valores `$0.00`/`$856M`/`$140.00`, prose `US$ 5`/`US$ 10`,
nenhum `US$` sem espaço restante.

## v1.94 — 2026-08-07 — BATCH 5: formato USD canônico `US$ X.XX`

Decisão de produto do Eduardo: o formato humano canônico é **`US$ X.XX`** (`US$ 5.00`,
`US$ 1,250.00`), e a UI não pode usar um formato enquanto o email do participante usa outro.

A plataforma tinha **quatro** formatos em produção para o mesmo tipo de valor: `US$5` (UI do
Powerball), `$1,250.00` (email do Powerball), `$5` (Copa, com `.00` removido — e a mesma lambda
**triplicada** no arquivo) e `$65`/`$0` (potes do CDB2026/BR2026/Copa, interpolação direta).

Formatador canônico novo, uma implementação por runtime porque não há build step neste repo:
`bolao/shared/js/money.js` (navegador), `bolao/shared/scripts/money.mjs` (Node/email),
`bolao/shared/scripts/money.py` (Python/email). As três são comparadas por
`bolao/shared/scripts/test_money_interop.mjs` contra a mesma tabela de valores — divergir faz a
suíte falhar.

**Duas divergências reais de arredondamento foram encontradas pelo próprio teste de interop:**
`5.005` dava `US$ 5.01` no JS (`Intl`) e `US$ 5.00` no Python (half-even); `1250` compacto dava
`US$ 1.3K` no JS e `US$ 1.2K` no Python. Nenhum default de linguagem é "o certo" para dinheiro — o
que importa é a plataforma concordar. O arredondamento para centavos agora é **explícito e half-up**
nos três runtimes (`Math.round` no positivo; `math.floor(x + 0.5)` no Python).

Escopo deliberado: **só dinheiro**. Nenhum `toLocaleString` de DATA foi tocado.

## v1.93 — 2026-08-07 — Snapshot ESPN server-side: as barras de probabilidade voltam a aparecer

**Este era o pior caso da plataforma.** A produção chamava
`https://site.api.espn.com/apis/v2/sports/soccer/bra.1/standings` DIRETO do navegador e o browser
bloqueava por CORS em toda carga de página (registrado no smoke ao vivo:
`Access to fetch ... has been blocked`). As barras de probabilidade dependem da tabela
(`only when standings are loaded`), então elas **simplesmente desapareciam** — sem mensagem nenhuma
para o participante. Não era degradação percebida como erro: era ausência silenciosa.

Os três endpoints passam a ler snapshots normalizados gerados server-side
(`bolao/shared/scripts/espn_provider.py` + `scripts/sync_espn.py`), versionados no repo e servidos
da mesma origem da página:

- `standingsUrl` → `data/espn-standings-normalized.json`
- `scoreboardUrl` → `data/espn-normalized.json`
- `scheduleUrl` → `data/espn-normalized.json` (o mesmo arquivo, de propósito: o snapshot já cobre a
  temporada inteira, que era o que a antiga `scheduleUrl` com `dates=...&limit=500` buscava)

- `fetchStandings()`: o parse dos `stats[]` da ESPN (rank/points/gamesPlayed/goalsFor/...) já
  acontece no provider, UMA vez, então o `getStat()` local saiu — manter dois parsers da mesma coisa
  é a duplicação que causa divergência silenciosa. **Preservado como lógica deste app:** o desempate
  determinístico (rank → saldo → gols pró → nome), porque a classificação provisória G4/SA6/Z4 é
  fatiada por índice do array e um empate de rank da ESPN podia errar a fronteira entre zonas
  (achado de auditoria, 2026-07-14); e o aviso de time sem correspondência em `DATA.teams`.
- `snapshotEventsToEspnShape()`: adaptador para a forma crua da ESPN que o código a jusante já
  esperava — mesma técnica da Copa e do CDB2026. Troca a FONTE, não o comportamento.
- `fetchEspnEventSummary()` virou no-op documentada (era a única fonte de substituições e era uma
  chamada de navegador para a ESPN). Consequência registrada: o feed ao vivo mostra gols e cartões,
  não substituições.
- `index.html`: `site.api.espn.com` removido do `connect-src` do CSP.
- Contrato de falha preservado: `null` / cache anterior mantido. Nenhum dado inventado. `stale: true`
  não é erro.

Verificado em browser real: **0** requisições diretas à ESPN, 30 linhas de classificação com nomes
reais de time, 30 células de zona, **174 `.prob-bars` com 522 segmentos renderizados**, nenhum erro
de console, nenhum 4xx/5xx. `audit_scoring.py` do BR2026 segue passando — scoring intocado.

## v1.92 — 2026-08-07 — HOTFIX: origem de produção errada no guard de test isolation

O guard de test isolation entregue na versão anterior usava
`PRODUCTION_ORIGIN = "https://ferrarilabs.github.io"`. **Essa não é a origem de produção.** O
`CNAME` na raiz do repo aponta para `www.ferrarilabs.com`, e o github.io (e o apex) respondem
**301** para lá. Ou seja: nenhuma página de produção executa em `ferrarilabs.github.io`, e o guard
estava bloqueando **toda** gravação remota de **todos** os participantes reais, nos três apps.

Pior: em silêncio. O guard devolve `skipped` em vez de rejeitar, então `saveState()` não caía no
`.catch()` e nem o toast de `syncFailed` aparecia — o participante via "salvo" com o dado só no
navegador dele. Exatamente a classe de falha que a AUDIT-04 já tinha corrigido neste arquivo.

Detectado na **verificação ao vivo** pós-deploy (o `curl` na produção mostrou o 301 para
`www.ferrarilabs.com`), não pela suíte — a suíte comparava o guard com um literal transcrito, então
concordava com o erro. Janela de exposição: entre o deploy da versão anterior e este.

- `js/app.js`: `PRODUCTION_ORIGIN` (string) → `PRODUCTION_ORIGINS` (allowlist) contendo
  `www.ferrarilabs.com` (canônico, do CNAME), o apex e o github.io. Os dois últimos só
  redirecionam hoje, mas se o CNAME for removido a produção passa a servir do github.io e o guard
  não pode virar bloqueio total. Match por igualdade dentro da lista — nunca substring.
- `bolao/scripts/audit_test_isolation.mjs`: passa a **ler o `CNAME`** e falhar se o domínio real
  não estiver na allowlist. É o check que faltava; verificado por controle negativo — restaurar o
  valor errado faz a suíte falhar em 3 checks nos três apps. 36 checks.

Lição registrada: um guard de segurança que decide sobre a identidade do ambiente tem de derivar
essa identidade de uma fonte de verdade versionada (aqui, o `CNAME`), nunca de um literal — e
nenhuma verificação de deploy pode ser considerada completa sem checagem ao vivo.

## v1.91 — 2026-08-07 — TEST ISOLATION (P0): gravação remota fail closed fora da produção

Propagação da correção P0 aberta pelo incidente de produção do CDB2026 (ver
`docs/bolao/TEST_ISOLATION.md`). O incidente foi no CDB2026, mas a causa raiz é idêntica nos três
apps: `url`/`anonKey`/`stateId` de produção são hardcoded em `js/config.js`, então qualquer harness
que carregue a aplicação grava na tabela real. Não havia flag de teste — porque não existia nenhuma.

Regra: gravação remota é NEGADA por padrão quando `location.origin` não é
`https://ferrarilabs.github.io` OU `navigator.webdriver` é verdadeiro (Playwright/Puppeteer/
Selenium). Participantes reais nunca satisfazem nenhuma das duas.

- `js/app.js`: guard `productionWritesAllowed()` dentro de `saveRemoteState()`, **antes** de
  qualquer chamada remota — o único ponto por onde toda escrita remota passa. Não em cada
  chamador: um guard que depende do teste lembrar de chamá-lo é convenção, não fronteira, e foi
  uma convenção que falhou no incidente. A escrita local (`localStorage`) segue normal — nada é
  perdido, só não vaza.
- Escape hatch deliberado, para administrar produção de um preview local:
  `sessionStorage.setItem("br2026_allow_production_writes", "I UNDERSTAND")` — precisa ser digitado, valor exato,
  namespaced por app, morre ao fechar a aba, e avisa no console a cada gravação. `sessionStorage`
  lançando é tratado como override ausente (fail closed, nunca fail open).

Limitação registrada de propósito: é controle de camada de aplicação, não fronteira de banco. NÃO
impede um POST direto na REST API com a anon key (que é pública por construção). Enforcement real
via RLS por role/origem fica para a modernização do banco — segue como o risco de produção aberto
de maior severidade.

Testes: `bolao/scripts/audit_test_isolation.mjs`, 33 checks nos três apps (produção permitida;
localhost/127.0.0.1/`file://`/webdriver negados; override correto libera; override com valor errado
não libera; `sessionStorage` lançando não libera; chave namespaced; origem não casa por substring).
O check de chokepoint foi verificado com controle negativo — neutralizar o guard faz a suíte
falhar. Scoring intocado; `audit_scoring.py` dos três apps segue passando.

## v1.90 — 2026-08-04 — Phase 7 of platform visual-framework migration: real visual validation + 2 bug fixes

Phase 6 shipped without a real browser (none available). Phase 7 installed Playwright + a real
Chrome binary and re-verified everything with actual captures/computed styles — see
`docs/bolao/evidence/canonical-framework/README.md` for the full account, and
`docs/bolao/CONSISTENCY_MATRIX.md`'s phase 7 entry for the reclassification of every previously
"preserved" divergence.

Two real, previously-unfixed bugs found and fixed here (Eduardo authorized fixing alignment/
button divergences that aren't excused by tournament-structure differences):

- **`.prob-bar` `min-width`**: was `6px` (inherited from the shared canonical rule, itself a
  latent Copa-side legibility bug — a real Chrome measurement showed a 3% segment's percentage
  label genuinely clipped at that width). This app's own `32px` override — carried since phase 3
  without being named a real fix — turned out to be the CORRECT value; promoted to the shared
  canonical rule, this app's now-redundant local override removed.
- **`.sticky-submit` alignment**: was `justify-content: center`, diverging from Copa's canonical
  `flex-end` for no functional reason (same button, same form context). Local override removed;
  now inherits the shared value.

Computed-style audit (`bolao/scripts/audit_visual_consistency.mjs`, real Chromium): 0 unapproved
divergences (was 8 before a CDB2026-side test-fixture date bug was fixed — unrelated to this
app). 0 console errors, 0 horizontal overflow, 0 sticky-submit overlap, confirmed live at
390×844/768×1024/1440×900.

## (tooling, no siteVersion bump) — 2026-08-04 — Phase 6 of platform visual-framework migration: evidence + wrap-up

Final phase of the 6-phase migration. No CSS/JS changes to this app in this phase — see
`bolao/copa2026/CHANGELOG.md`'s same-dated entry and
`docs/bolao/evidence/canonical-framework/{README.md,COMPONENT_AUDIT.md}` for the full wrap-up
(component audit across all three apps, honest screenshot-tooling limitation, final full
test/audit re-run — all pass).

## v1.89 — 2026-08-04 — Phase 5 of platform visual-framework migration: admin visual standardization

Visual-only pass over the admin UI as part of the platform-wide migration (phases 2-4 migrated
Copa/BR2026/CDB2026 onto `bolao/shared/css/`). Admin shell/login card/toolbar/buttons/tables
were already unified by the earlier phases (all three apps' `#adminLogin` uses the shared
`.card` + `.form-grid` + button primitives; `.admin-toolbar` has been a shared rule since phase
3). This phase found and fixed one real remaining divergence:

- **`.admin-row label` was missing its inline-layout override** — `.admin-row` (used by
  `renderAdminResultsPanel()`'s G4/SA6/Z4 result-entry rows) puts a bare `<label for="...">`
  next to a `<select>` on one line, but the shared canonical `label { display:flex;
  flex-direction:column; }` (bolao/shared/css/forms.css, built for the Palpites form where label
  text stacks above its input) made that label stack vertically above the select instead of
  sitting inline beside it — a real visual regression the shared-framework migration would have
  otherwise silently introduced (this cross-app dependency didn't exist before phase 3).
  CDB2026 already had the correct fix for its own identical `.admin-row label` (added earlier,
  outside this migration) but it was never copied over to BR2026. Fixed by adding the same
  `flex-direction: row` override here.
- No admin auth, session/lockout, persistence, or `.js` business logic touched — CSS only.
- **Functional admin bugs noticed but not fixed** (per CLAUDE.md: never mix a refactor with a
  bug fix in the same patch) — none found during this pass. The `.admin-row label` issue above
  is a visual/CSS regression risk introduced by the shared-framework migration itself, not a
  pre-existing functional bug, so fixing it here (as part of the same migration that would have
  caused it) is in scope.
- New: `bolao/scripts/check_shared_visual_contract.mjs` (cross-app, not owned by this app) —
  static CSS gate that flags any local app CSS rule redefining a protected shared-component
  property (font/color/spacing/shape) on a protected selector (`.card`, `.topbar`, `.nav`,
  `.button`, `.admin-toolbar`, `.form-grid`, etc.) without a formally declared variant suffix.
  Passes clean against this app's `css/styles.css` after the fix above.

## v1.88 — 2026-08-04 — Phase 3 of platform visual-framework migration: adopt shared canonical framework

Copa (`bolao/copa2026/`) is the platform's canonical visual reference (`CLAUDE.md`, "Golden
master rule"). Phase 2 (previous commits) built `bolao/shared/css/` from Copa's real values and
migrated Copa itself; this phase migrates BR2026 to the same shared framework — copying Copa's
visual tokens only, never its tournament logic (BR2026's own G4/Z4/SA6 scoring, standings, and
projection model are untouched).

- `index.html` now loads the 8 `bolao/shared/css/*.css` files before this app's own
  `css/styles.css`, same pattern as Copa.
- Trimmed `css/styles.css` from 910 to 611 lines by removing rules now fully covered by the
  shared files (reset, tokens except `--yellow`, body/button base, topbar/brand/nav, `main`/
  `.card`, `h1-h3`, `.page`/`.section-head`, `.form-grid`/inputs, `.admin-toolbar`, `.hidden`,
  `.muted`, focus-visible/h2:focus, toast, base `.rank-row`/`.points`, base `.game-card` box),
  replacing each with a pointer comment. Kept untouched: G4/Z4/SA6 pick groups, live match/live
  ranking hero, standings table, movement indicators, probability tables, admin results grid,
  and every projection-language string/disclaimer (`rankingTitle`, `projectionDisclaimer`,
  `accuracyIndexLabel`, etc. in `js/i18n.js` — not touched at all, per the standing rule that
  every classification shown before the Brasileirão ends must read as a projection).
- **Desktop nav tab count**: BR2026 has 7 always-visible tabs (Copa has 6 — no "Tabela"). Rather
  than fork the shared `.nav` rule, `shared/css/tokens.css` gained a `--nav-cols-desktop`
  custom property (default 6, Copa's real value) and `shared/css/{navigation,responsive}.css`
  now read `var(--nav-cols-desktop, 6)`. This app's own `:root` overrides it to `7`. Chosen over
  a scoped local override because it keeps exactly one shared `.nav` rule for all three apps
  instead of three near-duplicate forks — CDB2026 (phase 4) will do the same if its tab count
  differs from Copa's.
- **game-card**: box styling (background/border/radius/padding/margin) now comes from the shared
  canonical `.game-card`; BR2026's own `display:flex; flex-direction:column; gap:4px` kept as a
  local addition (Copa's `.game-card` isn't a flex container). Deliberately NOT renamed:
  `.game-matchup`/`.match-team`/`.match-team-name`/`.game-status` keep their own BR2026 class
  names rather than Copa's `.game-teams`/`.game-team`/`.status-chip` — those are generated by
  `js/app.js` render templates, and renaming them means editing `.js` (out of scope for a
  CSS-only visual migration; their token values already mirror Copa's 1:1, so there's no visual
  gain to justify a JS-touching regression risk).
- **Preserved intentional divergence, not silently fixed**: `.sticky-submit` keeps
  `justify-content: center` as a local override on top of the shared `flex-end` default — a
  pre-existing difference from Copa this migration is not authorized to resolve on its own
  (CLAUDE.md: "não corrigir silenciosamente tudo que a auditoria encontrar"). Flagged here for
  Eduardo to decide; `docs/bolao/CONSISTENCY_MATRIX.md` item 66 already tracks `.sticky-submit`
  shadow/min-width as CONSISTENT but doesn't yet catalogue the alignment difference.
- Not touched: any `.js` file's logic, scoring, business rules, Supabase, EmailJS.
  `python3 scripts/audit_scoring.py` re-run after this change for all three apps, still passes.

## v1.87 — 2026-08 — PR120-final review item 7: audit_visual_consistency.mjs reaches exit 0

Full rationale/findings documented once in `bolao/cdb2026/CHANGELOG.md` v3.85 (same change,
touches all three apps equally). Summary: fixed a real selector-ambiguity bug (CDB2026 has two
`.form-grid` elements; the generic selector picked the wrong, hidden one) via a new
`data-visual-audit="form-grid"` marker on the real entry-form grid in all three apps (purely
additive attribute, no CSS/behavior change) — same technique item 3 already used for
`.card`/`h3`/buttons. The remaining 7 DIVERGENT findings (form-grid height, button-small/danger
height, game-card gap/height, status-badge gap/minHeight) were investigated with a Playwright
probe, confirmed content/structure-driven rather than token bugs, and documented in
`docs/bolao/evidence/visual-comparison/ALLOWLIST.json` with verifiable justifications.
`audit_visual_consistency.mjs` now exits 0 (365 EQUAL, 13 JUSTIFIED, 0 DIVERGENT). No
scoring/classification logic touched. Also retroactively covers the prior (unversioned)
commit's item 3/4 work — `data-visual-audit` markers and `.form-grid` margin/`.rules-table`
font-size/`.game-card` padding+border-radius+margin-bottom alignment to Copa — which should have
bumped `siteVersion` and didn't; noted here rather than rewriting that commit's history.

## v1.86 — 2026-08 — PR120-final review item 2: unify cache-bust (content-hash, not commit-SHA)

Same platform-shared fix documented in full in `bolao/cdb2026/CHANGELOG.md` v3.84 (new
`bolao/scripts/cachebust.mjs` is the single source of truth for the `?v=` tag; the workflow
`.github/workflows/sync_version.yml` and the local checker now compute/apply the exact same
content hash instead of two incompatible values). This app's `index.html` was rewritten to
`?v=5032d96b0455` (matches the current content hash of its own five critical files) as part of
that same commit. No scoring/classification logic touched.

## v1.85 — 2026-08 — Fase 2.2-correção item 8: `main` padding + `.form-grid` aligned to Copa

**Explicitly authorized by Eduardo** (previously deliberately left unapplied pending exactly this
authorization — see v1.75/`docs/bolao/FASE2.2_CORRECAO_FINAL_REPORT.md`). Two numeric-only CSS
changes, no HTML/JS touched:

- `main` padding: `16px 14px` → `20px 18px`, matching Copa (`bolao/copa2026/css/styles.css`,
  the platform's canonical visual reference). Only visible above the existing
  `@media (max-width: 900px)` breakpoint — that breakpoint already forced all three apps to the
  same `12px 10px`, so phone/tablet rendering (≤900px) is unchanged; only desktop-width `main`
  gets wider now, matching Copa exactly.
- `.form-grid`: `repeat(auto-fill, minmax(220px, 1fr))` gap `14px` → `repeat(2, minmax(0, 1fr))`
  gap `12px`, matching Copa. Added a `.form-grid { grid-template-columns: 1fr }` rule inside the
  existing `@media (max-width: 900px)` block (this app didn't have one before — Copa did), so the
  grid still collapses to a single column on narrow screens exactly like Copa.

**Real finding, not just cosmetic**: without the new breakpoint override, the entry form
(4 fields: nome/responsável/e-mail/método) rendered as **3 cramped columns at 768px** (tablet
width) under the old `auto-fill` rule — verified via `getComputedStyle` probe
(`gridTemplateColumns` resolved to `227.328px 227.328px 227.328px`) and a real screenshot crop.
Copa, at the same 768px width, already collapsed to 1 column (its own `@media (max-width:900px)`
override). So this fix isn't only a desktop (>900px) visual alignment — it also fixes a real
tablet-width layout inconsistency BR2026 had versus Copa.

**Verification before applying** (per `docs/bolao/QA_MASTER_CHECKLIST.md` risk assessment for a
`main`-wide change on an app used in production-adjacent testing): captured real Playwright
screenshots of the Palpites/entry form at 320×568, 768×1024, and 1440×900, before and after, for
BR2026, CDB2026, and Copa (unaffected control). Confirmed: `document.documentElement.scrollWidth`
never exceeds `clientWidth` at any of the three viewports (no new horizontal overflow); the
4-field entry form now wraps into a clean 2×2 grid at 1440px (was 1 row of 4, tightly packed
against the wider `main`); `.sticky-submit` is a normal in-flow block (`display:flex`, not
`position:fixed/sticky` despite the class name — confirmed by reading the CSS), so it can't ever
overlap a form field regardless of grid layout. 320px and 768px renders are pixel-identical to
before (both already resolved to the same breakpoint values pre-fix, confirmed via the 768px
`gridTemplateColumns` probe above once the mobile override was in place).

Re-ran `bolao/scripts/audit_visual_consistency.mjs` after the change:
`main:padding`, `form-grid:gap`, and `form-grid:gridTemplateColumns` all flipped from DIVERGENT to
EQUAL across all three apps (342 EQUAL / 1 JUSTIFIED / 21 DIVERGENT, down from 339/1/24 before this
change — the 3-property delta is exactly this fix, nothing else moved). Remaining DIVERGENT for
this component (`.form-grid:margin`, `0px` in Copa vs `0px 0px 16px` here) was **not** in this
item's authorized scope (only `padding`/`grid-template-columns`/`gap` were named) — left
unauthorized-but-documented rather than fixed silently; see
`docs/bolao/CONSISTENCY_MATRIX.md` and `docs/bolao/evidence/visual-comparison/`.

`node --check`: clean. `audit_scoring.py`: 5/5 (CSS-only change, scoring untouched).

## v1.84 — 2026-08 — Fase 2.2-correção item 7/coord.#2: cross-app computed-style consistency audit

New `bolao/scripts/audit_visual_consistency.mjs` (top-level, cross-app). Full rationale,
methodology, and findings in `bolao/cdb2026/CHANGELOG.md` v3.80 (documented once in detail,
touches all three apps equally). Summary: 339/364 property comparisons EQUAL, 24 DIVERGENT
(documented, not auto-fixed), including BR2026-relevant methodology notes: `.game-card` didn't
render in this audit (BR2026's `renderGamesSection()` is gated behind a non-empty ESPN schedule,
which this script fakes as empty — same network policy as every other script in this folder,
never production). Report: `docs/bolao/evidence/visual-comparison/audit_visual_consistency.
{json,md}`. `audit_scoring.py`: 5/5 (unaffected).

## v1.83 — 2026-08 — Fase 2.2-correção item 3: tab nav column counts fixed, mobile orphan-row fix

Desktop `.nav` had `repeat(9, ...)` columns (base rule and the `min-width:901px` override) but
only 7 buttons are ever visible (Palpites/Ranking/Tabela/Jogos/Probabilidades/Regras/Admin —
Participantes/Pagamento permanently `display:none`) — 2 dead desktop columns. Fixed to
`repeat(7, ...)` in both places. Verified visually at 1024px (Claude Browser): 7 equal-width
columns, no dead space.

Mobile (already 3 columns, unchanged) had a real, visible defect: 7 buttons / 3 columns = 3+3+1,
so "Admin" sat alone in the final row at 1/3 width, left-aligned, two empty cells beside it —
confirmed with a real 320px screenshot before this fix. Added
`:nth-child(3n):nth-last-child(1) { grid-column: 1 / -1 }` so the lone last button spans the full
row instead. Re-verified at 320px after the fix: Admin now spans full width. Same accounting
applied to Copa (`bolao/copa2026/CHANGELOG.md`), which has the identical DOM structure (two
hidden nav buttons inside `.nav`).

Propagated across all three apps in the same round. `audit_scoring.py`: 5/5 (unaffected).

## v1.82 — 2026-08-02 — Tab nav: `aria-current="page"` on the active section button

Propagated from Copa (v4.164) per the Fase 2.2 visual/accessibility audit
(`docs/bolao/VISUAL_PARITY_MATRIX.md`): `showSection()` now toggles `aria-current="page"` on the
active `.nav button[data-section]` (removed on the rest), same shape as Copa/CDB2026. No visual
change, no scoring/logic touched. `audit_scoring.py`: 5/5.

## v1.81 — 2026-08-01 — Live clock stoppage-time cap missing for regular-time periods (propagated from CDB2026)

Same defect class found live in CDB2026 (Vasco×Fluminense, Oitavas, 2026-08-01): the live clock's
"(+N)" stoppage display and the underlying interpolated clock had no ceiling for periods 1-3
(regular time) — only period 4 (extra time) was capped. If a single 60s poll doesn't land right
when a match pauses, the display can climb indefinitely instead of stopping.

Fixed: `formatMatchClock()`'s cap now applies to any known period. Added a companion cap in
`liveClockDisplay()`'s interpolation itself (3x the poll interval) so even a stuck poll can't make
the display run away. `audit_scoring.py` re-run, passing — scoring/G4-Z4 tiebreaks untouched.

## v1.80 — 2026-08-01 — `.sticky-submit` CTA overlap fixed (propagated from CDB2026 Fase 2.2)

Same defect class found and fixed in CDB2026 (its "Salvar entrada" button visually covering the
"Nova entrada" `<h2>` on mobile) was confirmed here too via a comprehensive cross-app audit — 57
overlap findings across viewports/scroll positions, including the exact same `<h2>` "Nova
entrada" case at 320×568 (entries are closed since 2026-07-16, so the Palpites nav is currently
disabled in production, but the CSS/DOM still has the bug and this page will reopen for a future
cutoff).

Fixed the same way: removed `position: sticky` from `.sticky-submit`, button now lives in normal
document flow — structurally unable to overlap a sibling. Re-ran the check after the fix: 0
findings across all 7 viewports. `audit_scoring.py` re-run, still passing (scoring/ranking/G4-Z4
tiebreaks untouched).

## v1.79 — 2026-07-29 — "Jogos de hoje" showed postponed matches as finished 0-0 results

Eduardo, once today's 4 rescheduled matches (from the earlier postponed-detection fix, #116)
actually landed on today's date: "Nos jogos de hoje aparece jogos que terminaram mas nem foram
jogados ainda, foram adiados pelo jeito."

**Root cause**: `renderNextGameCard()`'s "Jogos de hoje" card checked only `g.state === "post"`
to decide whether to show a game as a finished result — the same class of gap `renderGamesSection()`
(the full "Jogos" tab) already guards against correctly (it checks `g.postponed` first). ESPN
uses `state:"post"` for both a real final result and a postponed/canceled game (only
`completed:false` + the `postponed` flag — fixed in #116 — tell them apart), so all 4 matches
postponed to today rendered as "Encerrado 0 – 0" instead of "Adiado". `postponed` itself was
already correct since #116; this card just never consulted it.

Verified with real ESPN data for today (2 genuinely live matches, 4 postponed, 2 upcoming) via
the page's own exposed test hooks: before the fix, all 4 postponed matches showed as finished
0-0s; after, they show "Adiado" with no score, matching how the full Jogos tab already displays
them. Also re-verified the live-match card itself renders correctly with today's 2 live games —
could not reproduce a separate "live games not showing" issue from the same report; most likely
explained by the same confusing postponed-as-finished display crowding it out visually.

CDB2026 checked for the same gap — its equivalent card (`renderNextTieCard()`) only ever shows
future kickoffs, never past/decided results, so it has no equivalent vulnerable code path. No
propagation needed there.

`audit_scoring.py` — 5/5, unaffected (game-list display logic only, no scoring touched).

## 2026-07-26 — Round-completion email stuck: batch window bundled two rounds together (no siteVersion bump — Python script only)

Eduardo: "A rodada acabou hoje e o email não foi enviado."

**Root cause**, confirmed against real GitHub Actions logs and real Supabase state (not
guessed): `send_round_email.py`'s batching opens a window of `BATCH_WINDOW_DAYS` (was 7) past
the earliest not-yet-covered game, and won't send until every game in that window is finished.
The round that finished 2026-07-25/26 (10 games) opened a batch reaching to 2026-08-01 — wide
enough to also sweep in the *next* round's 10 games (kicking off just ~3 days after the
previous round ended) plus 4 rescheduled/postponed games dated the same week. The batch was
correctly waiting for all 20 — including 6 games that hadn't been played yet — before sending
anything, so the round that had already finished never got its email. Verified this was the
actual mechanism by pulling the real `roundEmail.pendingBatch` from Supabase (20 gameIds,
window 2026-07-25→2026-08-01) and the real ESPN schedule for each of those IDs, and by reading
the real job log ("Batch not complete yet — 10/20 game(s) still pending").

Separately confirmed the batch-completion check itself was NOT the bug — `send_round_email.py`
already correctly uses `status.type.completed` (not the string-name comparison that was broken
in `app.js`, see the postponed-match fix above), so the 4 rescheduled games were correctly
recognized as unplayed. The only problem was the window being wide enough to reach the next
round at all.

**Fix**: measured the real 2026 schedule end-to-end (all 41 rounds, not just this one) —
worst-case within-round span is 52 hours, tightest real gap from one round's first game to the
next round's first game is 69 hours. `BATCH_WINDOW_DAYS` changed from 7 to 2.5 (60 hours),
which sits safely inside that margin on both sides. Dry-run against the real current pending
games confirms this reopens a clean 10-game batch (just the finished round) instead of 20.

**Also cleared the stuck batch directly in Supabase** (`roundEmail.pendingBatch` → null) so the
next scheduled run (the workflow already polls every 30 min in the evening/night window) opens
a fresh, correctly-sized batch with the fix in place, rather than staying stuck on the old
20-game window until this code change merged. `sentGameIds`/`sentBatches` untouched — no
already-sent email history was altered.

`audit_scoring.py` — 5/5, unaffected (batching-window constant only, no scoring logic touched).

## v1.78 — 2026-07-26 — Postponed matches were being counted as real 0-0 results, inflating up to 8 teams' live points/games

Eduardo: "Verifique se os dados da tabela estão corretas em outros sites mostra pontuação
diferentes." (table data correctness check, after other sites showed different points.)

**Investigation** (not a guess — independently reconstructed the full table from raw ESPN match
results in Python and cross-checked against ESPN's own official standings endpoint): found ESPN's
official aggregate is internally consistent with its own schedule feed once postponed matches are
correctly excluded (0 mismatches across all 20 teams). So the discrepancy wasn't upstream data —
it was in how this app classifies a match as postponed.

**Root cause**, confirmed live on the actual production page: `fetchSchedule()`'s `postponed`
flag compared ESPN's machine status constant (`status.type.name`, e.g. `"STATUS_POSTPONED"`)
against the human-readable string `"Postponed"` — which never matches (the human string lives in
`status.type.description`, a different field). So `postponed` was always `false`, and 4 real
rescheduled matches (dated 2026-07-29, `state:"post"` but `completed:false`) got treated as
finished 0-0 draws by `windowCompletedMatches()`/`calculateLiveStandings()` — the exact functions
behind the live Tabela and the G4/Z4/SA6 zones used everywhere (Ranking, Projeção do Bolão).
Verified via the page's own exposed test hooks with real ESPN data: before the fix, 8 teams
(Red Bull Bragantino, Botafogo, São Paulo, Atlético-MG, Santos, Grêmio, Vasco da Gama,
Chapecoense) showed +1 point and +1 game played beyond their correct values; after the fix, all
20 teams match ESPN's official standings exactly.

**Fix**: `postponed` is now `state === "post" && completed === false` — the actual reliable
signal (verified against real data: 191 real full-time results all have `completed:true`, the 7
postponed/canceled ones all have `completed:false`, zero ambiguous cases).

Same bug, same fix, in `bolao/cdb2026/CHANGELOG.md` v3.54 — CDB2026 explicitly ported this exact
check from BR2026 (with the exact same string-mismatch bug baked in) for its own postponed-leg
badge. Copa doesn't have an equivalent standings/postponed-detection component — no propagation
needed there.

`audit_scoring.py` — 5/5 on all three apps, unaffected (this fixes ESPN-status parsing feeding
the *live projection*, not the bolão's own scoring formula, which was never touched).

## v1.77 — 2026-07-25 — Tabela: G4/SA/Z4 zone badges now line up in a straight column

Eduardo, follow-up to v1.76: "Poderia deixar alinhado o Z4, G4, SA tambem."

`.td-team-name` used `max-width` (a cap, not a fixed size), so its actual rendered width tracked
each row's real name length up to that cap — a short name like "Bahia" left the badge sitting
right after it near the left edge, while a name that hit the cap (truncated with an ellipsis)
pushed the badge much further right. Every row's badge landed at a different x position.

Changed `max-width` to `width` (with `flex-shrink: 0`) and made `.td-team` a flex container, so
the name box now always occupies exactly the same horizontal space regardless of content —
short names get padded with empty space instead of letting the badge creep left. Badges for
every row now start at the identical x position. `flex-shrink: 0` also added to keep the name
box from being the one squeezed instead, now that it's competing for space with the badge as a
flex sibling.

Verified with real ESPN standings data at 430px and 375px — checked every row, badges align in a
straight vertical line, and both earlier fixes (v1.75's no-overlap stat columns, v1.76's no-wrap)
still hold. `audit_scoring.py` — 5/5, unaffected (CSS-only change).

## v1.76 — 2026-07-25 — Tabela: long team names wrapped the zone badge to a second line on mobile

Eduardo, follow-up to v1.75: "Não deveria ter pulo de linha pelo tamanho do nome do time. Ideal
abreviar um pouco mais no mobile."

`.td-team-name`'s truncation width (92px, ellipsis + ' overflow: hidden') was sized only against
the 128px mobile column width, without accounting for the G4/SA/Z4 zone badge that sits right
after it in the same cell — for teams whose name is long enough to actually hit that 92px cap
(e.g. "Athletico Paranaense", "Vasco da Gama"), name + badge together (~92px + ~29px) exceeded
the 112px of content room the 128px cell has after padding, so the badge wrapped to its own line
instead of sitting inline.

Fixed by tightening the truncation width from 92px to 76px, leaving enough room (76 + ~29 = 105px
< 112px) for the badge to always stay on the same line as the name. Verified against every real
team name currently in the table, including the longest ones with a badge (Athletico Paranaense,
Fluminense, Vasco da Gama, Chapecoense) — no wrap on any row, at both 430px and 375px viewports.
Desktop (900px+) truncation width is untouched (`max-width: 190px`, plenty of room there).

`audit_scoring.py` — 5/5, unaffected (CSS-only change).

## v1.75 — 2026-07-25 — Tabela: "J" (games played) and other stat columns were truncating on mobile

Eduardo, screenshot: "A visualização da tabela no mobile ta meia ruim, ta truncando o numero de
jogos, tem que mexer pro lado e mesmo assim fica ruim."

**Root cause**, confirmed by measuring the real rendered layout (not guessed): `.standings-table`
uses `position: sticky` for the Pos/Mov/Time/Pts columns so they stay pinned while J/V/E/D/GP/GC/SG
scroll underneath, with each sticky column's `left` offset hardcoded as the sum of the preceding
columns' declared widths (e.g. `.td-pts { left: 200px; }` assumes 32+40+128). The table never set
`table-layout`, so it defaulted to `auto`, which recomputes column widths from content across
every row in the table — those widths don't reliably match the declared ones the offsets assumed.
Measured via `getBoundingClientRect()` on the real page: `.td-team` rendered at 108px instead of
its declared 128px, which pushed `.td-pts`'s sticky box to end 12px into the very next column's
(J's) space. Since the sticky Pts cell paints a solid background, those 12px of the J column's
leading edge were covered by it — a two-digit value like "19" only showed its last digit, "9",
matching the screenshot exactly (and explaining why some rows looked like "0" too: values in the
10-20 range with the leading "1"/"2" clipped).

**Fix**: added `table-layout: fixed` to `.standings-table`, which makes the declared widths
authoritative instead of content-dependent, guaranteeing the sticky offsets match the real boxes.
Also widened J/V/E/D/GP/GC/SG from 30px to 32px with tighter side padding (8px → 4px) — comfortably
fits two-digit values (routine mid-season, e.g. "19"/"20"/"21" games played) with margin to spare,
which also makes fewer columns of the same content group visually cramped and slightly reduces how
far you have to scroll for the rest, addressing "mesmo assim fica ruim" from the same report.

Verified with real ESPN standings data at both 430px and 375px viewport widths, unscrolled and
scrolled all the way to the last column — measured zero column overlap after the fix (every
cell's right edge now lands exactly on the next cell's left edge) where before there was a 12px
overlap.

TOURNAMENT_SPECIFIC / no cross-app propagation: Copa and CDB2026 are knockout-bracket formats
with no ongoing points table, so neither has an equivalent sticky-column standings component to
check. `audit_scoring.py` — 5/5, unaffected (CSS-only change). No app-code (`app.js`) touched.

## v1.74 — 2026-07-25 — Live score/clock went stale after backgrounding the tab; needed a manual refresh

Eduardo, after confirming the earlier "placar ao vivo sumiu" report was just a stale browser
cache: "Still doesn't seem to be working as well as copa was. I have to refresh to get an
updated score and the clocks are not in sync with the actual game time. Something is off. Do a
deep research."

**Root cause**, found by comparing BR2026's `init()` against Copa's line by line: Copa's
`focus`/`pageshow`/`visibilitychange` handlers all call `startLiveScorePolling()`, which does an
immediate ESPN poll and (re)arms the polling loop — added to Copa after a real past incident
where a backgrounded-tab restore left the page stuck on stale in-memory state (see
`docs/bolao/LESSONS_LEARNED.md` "Safari" / bfcache). BR2026 already had the identical `pageshow`/
`focus` handlers (with the same code comment explaining the bfcache issue!) but they only called
`debouncedReload()` (Supabase entries/results resync) — the ESPN live-score poll (`pollAll()`/
`schedulePoll()`) was never re-triggered on resume. So: background the tab (lock the phone,
switch apps) during a live match, come back, and the score/clock stay frozen at whatever they
were when the tab was backgrounded until a manual reload forces a fresh poll — exactly "have to
refresh to get an updated score" and "clocks not in sync," since the on-screen clock keeps
ticking forward in memory from an increasingly stale base with no new poll to correct it.

Verified this was the actual mechanism (not a guess) by rebuilding the page locally with real
ESPN data for today's two live Brasileirão matches and confirming: before the fix, dispatching a
simulated bfcache-restore `pageshow` event triggered zero new ESPN requests; after the fix, it
triggers an immediate one.

**Fix**: `schedulePoll()`'s self-rescheduling `setTimeout` chain now carries a generation token
so a resume can safely restart it without risking a second parallel chain if the old one turns
out to still be alive. Added a `resumeLivePolling()` helper (`pollAll(); schedulePoll();`) called
from `focus`, `pageshow` (bfcache restore), and `visibilitychange` — moved out from inside the
`if (C.database.enabled)` block since live ESPN polling doesn't depend on Supabase being on. The
existing Supabase resync handlers are untouched, just now joined by this second listener on the
same events.

`audit_scoring.py` — 5/5, unaffected (poll-scheduling/event-listener change only, no scoring
logic touched). Same fix applied to CDB2026 in the same patch — see
`bolao/cdb2026/CHANGELOG.md` v3.53 — since it had the identical gap (its `pollLiveTies()` 60s
`setInterval` was never explicitly re-kicked on resume either, just relying on the interval's
own natural cadence, which real testing showed still doesn't get retriggered promptly on a
bfcache restore).



Follow-up to the round-email subject fix below (same day). The round-email fix covered dates;
this covers the other live source of "/" in a subject — free-typed entry names. Added
`emailSubjectSafe()` next to `receiptCode()` in `app.js` and applied it to `entry_name` in both
the participant confirmation email and the admin "Nova entrada" notification. Propagated
platform-wide (Copa + CDB2026 got the identical fix in the same patch — see
`bolao/copa2026/CHANGELOG.md` v4.161 for the full root-cause writeup). `audit_scoring.py` — 5/5,
unaffected. `node --check` clean.

## 2026-07-24 — Round-email subject showed literal "&#x2F;" instead of "/" (no siteVersion bump — Python script only)

Eduardo: screenshots of both the participant round-result email and the admin round-summary
email showing subjects like "Rodada 16&#x2F;07–23&#x2F;07 — resultados e classificação"
instead of "Rodada 16/07–23/07 — ...".

Root cause: `send_round_email.py` sends both emails through EmailJS's `template_xq7yzzb` (the
same template used for normal entry receipts), repurposing its `entry_name`/`receipt_code`
template fields to carry the round-email subject text (`send_email()`, no separate "subject"
param exists in the EmailJS payload). That template's **body** correctly uses `{{{html_message}}}`
(triple braces = raw) per the standing rule in `CLAUDE.md`, but its **Subject** field (configured
on EmailJS's dashboard, outside this repo) still references `entry_name`/`receipt_code` with
plain `{{}}` — which HTML-escapes the value, turning "/" into "&#x2F;". That was always true, but
never visible before: normal entry names never contain "/". BR2026's round-email feature
(added 2026-07-16) was the first thing to put a "/"-containing string (a date range) into that
field.

Fixed in code rather than requiring an EmailJS dashboard edit: added `_fmt_date_range_subject()`
in `send_round_email.py`, identical to `_fmt_date_range()` but using "." instead of "/" between
day and month. Used only for the three subject-line f-strings (participant, admin summary,
`--test-send`); the HTML body keeps the "/" format via the original `_fmt_date_range()` —
unaffected, since it goes through `{{{html_message}}}`.

`python3 bolao/br2026/scripts/audit_scoring.py` run after — 5/5, unaffected (subject-line
formatting only, no scoring/ranking logic touched).

## v1.72 — 2026-07-22

### Fixed — "próximo jogo" card got stuck on an already-finished game instead of showing the next upcoming one

Eduardo: "Proximos jogos do br2026 sumiu." Investigated with real ESPN schedule data before
touching anything — confirmed the real cause: right now (22:xx BRT, still July 21 in Brazil
time), the only match dated "today" (BRT) was Atlético-MG × Bahia, which had already finished
(19h30 kickoff, already in "post" state). `renderNextGameCard()`'s `todayGames` filter matched on
date only, never excluding already-finished matches, so the card got stuck rendering today's
stale final score instead of falling through to look ahead — even though the real next match
(Coritiba × Palmeiras, tomorrow) was sitting right there in the schedule the whole time.

Fixed: added `hasUpcomingToday` (true only if at least one of today's games is not yet "post")
to decide whether to fall through to `nextUpcomingGame()`'s next-day lookup, instead of the old
"any game dated today, finished or not" check. Verified against the real live schedule (382
events fetched from ESPN) that the old logic got stuck on the finished match while the fixed
logic correctly falls through to Coritiba × Palmeiras with the full countdown treatment.

Not propagated to Copa or CDB2026 — both use a different next-match architecture (`nextScheduledMatch()`/
`renderNextTieCard()`, single fixed bracket matches) without BR2026's "group all of today's games
together" feature, so this exact bug pattern doesn't exist there.

`audit_scoring.py`: PASSED, unchanged — display logic only, no scoring touched.

## v1.71 — 2026-07-19

### Changed — hid Participantes/Pagamento nav buttons

Eduardo: "Pode esconder os botões participantes, pagamento do br2026 nesse momento também" —
same treatment Copa already had (`bolao/copa2026/index.html`'s nav has had these two hidden via
`style="display:none"` since the app existed). Confirmed neither button was ever dynamically
un-hidden by `app.js` (no `"participants"`/`"payment"` references there) — same dead-nav pattern
as Copa, safe to hide with a one-line change per button, no JS logic touched.

`audit_scoring.py`: PASSED, unchanged — nav visibility only.

## v1.70 — 2026-07-19

### Changed — switcher's "Copa do Mundo" option now points at bolao/copa2026/

Copa 2026 moved from `bolao/` to `bolao/copa2026/` this same day (Eduardo wanted `/bolao/` to
actually redirect to this app instead of just cosmetically showing "Brasileirão" in the
switcher — see `bolao/copa2026/CHANGELOG.md` v4.159 for the full story). Updated this app's own
"Alternar bolão" switcher option value and the `allowed` array in its change handler so selecting
"Copa do Mundo" here lands on the new location instead of the now-redirecting `/bolao/` (which
would otherwise bounce straight back to this same page — an infinite loop).

`audit_scoring.py`: PASSED, unchanged — one link value updated, no app logic touched.

## v1.69 — 2026-07-19

### Fixed — substituições nunca apareciam nos lances ao vivo (mesmo bug da Copa, propagado no mesmo dia)

Achado real na Copa durante a Final ao vivo (Eduardo: "As substituições sumiram do lugar onde tem
os lances cartões e gols") — investigado com dado real e confirmado: o endpoint de scoreboard da
ESPN (`comp.details`, usado por `extractMatchPlays()`) nunca inclui eventos de substituição, só
gols e cartões. O BR2026 tinha exatamente o mesmo padrão de código (porta direta da Copa,
`comp.details`-only) — mesmo bug, nunca detectado antes por falta de um jogo ao vivo com
substituições reais durante os testes.

Correção idêntica à da Copa: novo `fetchEspnEventSummary(eventId)` busca o endpoint de summary por
evento da ESPN (`.../summary?event=<id>`, mesma liga `bra.1` do scoreboard), que tem um
`keyEvents` mais completo incluindo substituições — só chamado para partidas ao vivo no momento,
sem custo extra de rede em polls normais. `extractMatchPlays(comp, keyEvents)` prefere essa fonte
quando disponível, com fallback para `comp.details` se a busca extra falhar — gols/cartões nunca
regridem. Verificado que o endpoint de summary responde corretamente para a liga `bra.1` com dado
real da ESPN (sem partida ao vivo no momento da correção pra confirmar substituições reais, mas
estrutura/URL confirmadas).

`audit_scoring.py`: PASSOU, sem alteração — mudança somente de apresentação (busca extra da ESPN),
nenhuma pontuação/regra tocada.

## v1.68 — 2026-07-17

### Changed — cards ao vivo sempre abertos (lances/probabilidades), igual a Copa

Eduardo: "Outra coisa que percebi sumiu os lances: cartoes, gols, substituição." Investigado com
dados reais (3 jogos ao vivo simultâneos hoje) — os lances nunca sumiram, continuavam no HTML
normalmente (gols, cartão amarelo, tudo certo). O que mudou: com 3+ jogos ao vivo ao mesmo tempo,
os cards do BR2026 recolhem automaticamente por padrão (comportamento antigo, de antes desta
sessão — "First time a match id shows up: default expanded when it's just 1-2 games, collapsed
once a full round kicks off together"), exigindo clicar numa setinha pra abrir. A Copa nunca teve
esse recolhimento — sempre mostra os lances direto.

Confirmado com o Eduardo (pergunta feita antes de mexer, já que reverte uma decisão de design
antiga): remover o recolhimento automático — os cards ao vivo do BR2026 agora sempre mostram os
lances e as barras de probabilidade abertos, igual à Copa, mesmo com vários jogos rolando ao mesmo
tempo. Removida toda a lógica de expand/collapse (`_liveExpanded`, `_liveSeenIds`,
`defaultExpanded`, o botão/chevron ▲▼ e o listener de clique) — código morto depois da mudança,
junto com a chave i18n `liveToggleExpand`/`liveToggleCollapse` e a classe CSS `.live-chevron`,
sem uso restante.

Verificado com os 3 jogos reais ao vivo de hoje via Playwright — os três cards mostram os lances
sem precisar clicar em nada.

`audit_scoring.py`: PASSOU. Presentation-only, nenhuma fórmula de pontuação tocada.

## v1.67 — 2026-07-17

### Fixed — Ranking ao vivo/setas de movimento ficavam mudas no primeiro minuto de qualquer jogo ao vivo

Eduardo: "E no ranking também ninguém mexeu, verifique se isso é correto." Investigado com dados
reais de produção (entradas do Supabase + ESPN ao vivo) reproduzindo a página inteira, não só a
função de cálculo isolada — achado confirmado como bug real, não confusão de dados.

Causa: em `pollAll()`, o bloco que atualiza `_standings` com os dados recém-buscados da ESPN
rodava DEPOIS do bloco que decide se captura a baseline (`captureStandingsBaseline()`), mas essa
função lê a variável `_standings` (não os dados frescos que acabaram de chegar). Na PRIMEIRA vez
que um jogo fica ao vivo numa sessão nova (página recém carregada, `_standings` ainda vazio do
valor inicial), a captura da baseline rodava sobre uma tabela vazia, falhava silenciosamente
(guarda `null`, sem erro) — e só se corrigia no poll SEGUINTE, 60s depois, usando dados que já
deveriam estar disponíveis desde o início.

Efeito visível: no primeiro minuto de qualquer rodada ao vivo, tanto as setas de movimento no
Ranking quanto o hero "🏆 Ranking ao vivo" mostravam "–" (indisponível) pra todo mundo, mesmo
quando o resultado dos jogos já deveria ter mudado a posição de vários participantes.

Corrigido: `_standings` agora é atualizado ANTES do bloco que decide capturar a baseline, na mesma
chamada de `pollAll()`. Verificado com dados reais de produção — antes do fix, uma página recém
carregada com jogo ao vivo mostrava 11/11 participantes com "–"; depois do fix, no mesmo cenário
(mesmo timing, mesmo poll único), 8/11 já mostram seta real (▲/▼) no primeiro poll.

`audit_scoring.py`: PASSOU. O bug era de timing/estado, não de fórmula de pontuação — a conta em
si sempre esteve certa (confirmado chamando `calculateRankingMovement()`/`calculateLiveStandings()`
isoladamente antes de achar o bug de ordem).

## v1.66 — 2026-07-17

### Changed — local do jogo removido do card ao vivo

Mesmo pedido da Copa (ver changelog dela) — Eduardo: "Não precisa mostrar a localização no live
mode." BR2026 não tem "fase" (liga de pontos corridos), então a única coisa que `.live-match-meta`
mostrava era o local — removida a linha inteira do card ao vivo (`renderLiveCard()`). Limpeza:
também removida a extração de `comp.venue`/`comp.venue.address.city` em `fetchScoreboard()` (só
existia pra alimentar essa linha, agora código morto) e a classe CSS `.live-match-meta` (agora sem
uso no BR2026). Local continua aparecendo normalmente no card "Jogos de hoje"/"Próximo jogo"
(pré-live) e na lista completa de jogos — só o card AO VIVO não mostra mais.

Verificado com os 3 jogos reais ao vivo agora (Bahia × Chapecoense, Fluminense × Bragantino,
Mirassol × Grêmio) via Playwright.

`audit_scoring.py`: PASSOU. Presentation-only.

## v1.65 — 2026-07-17

### Changed — "Ranking ao vivo" agora aparece sempre que há jogo ao vivo

Eduardo, durante um jogo real ao vivo (Bahia 1×0 Chapecoense, 21'): "onde está o ranking
provisório? Você remove funcionalidades." Investigado: o hero não tinha sido removido, mas
ficava escondido por design sempre que ninguém ainda tinha cruzado uma fronteira de classificação
G4/Z4 desde a última base salva (`hasMover`, decisão do Eduardo em 2026-07-16: "se ficar ruim ou
muito busy deixa de fora"). Com 1 gol isolado aos 21' de 1 dos 3 jogos do dia, ninguém tinha se
mexido ainda — a caixa sumia bem na hora que fazia mais sentido mostrar algo.

Confirmado com o Eduardo (pergunta feita antes de reverter a decisão anterior): agora
`renderLiveRankingHero()` mostra a lista sempre que há jogo(s) ao vivo, com participantes que
ainda não tiveram sua posição comparada mostrando "–" (mesmo indicador neutro já usado quando a
baseline ainda não carregou) em vez de a caixa inteira sumir.

Verificado com o jogo real ao vivo (Bahia × Chapecoense) via Playwright — ranking aparece
corretamente.

Mesmo ajuste no CDB2026 (mesmo padrão de código, mesma decisão de produto — sem tie ao vivo pra
testar agora, Oitavas só começa 1º/ago).

`audit_scoring.py`: PASSOU. Presentation-only, nenhuma fórmula de pontuação tocada.

## v1.64 — 2026-07-17

### Fixed — local do jogo espremido no card ao vivo (bug real, não da Copa)

Eduardo, durante um jogo real ao vivo (Bahia 1×0 Chapecoense, 21'): "Ta feio isso nao ta igual a
copa." Bug real introduzido na v1.62 (PR #82, fase+venue no card ao vivo): `.live-match-meta`
(a linha com 📍 local do jogo) tinha sido colocada DENTRO de `.live-match-row` — só no BR2026 essa
div é um `<button>` `display:flex` (todo o card é clicável pra expandir/colapsar, com um ▲/▼ no
canto), então o novo bloco de local virava mais um item do flex HORIZONTAL em vez de cair pra
linha de baixo. Resultado: o local aparecia espremido no canto superior direito, por cima do
chevron, em vez de aparecer centralizado embaixo do placar (como na Copa/CDB2026, que não têm
esse wrapper extra). Corrigido movendo `.live-match-meta` pra fora de `.live-match-row` — agora é
irmão do `row`, dentro de `.live-match`, igual ao padrão da Copa/CDB2026.

Verificado com o jogo real ao vivo (Bahia × Chapecoense) via Playwright — local agora aparece na
própria linha, centralizado, igual à Copa.

`audit_scoring.py`: PASSOU. Bug era só de layout/CSS, nenhuma fórmula de pontuação tocada.

## v1.63 — 2026-07-17

### Changed — horário do jogo agora mostra EST/EDT e BRT juntos (EST primeiro)

Mesmo achado da Copa (ver changelog dela) — o BR2026 só mostrava BRT em todo lugar (`brtTimeStr`/
`brtLongDate`), sem EST. Adicionado `estTimeStr()` (usa `Intl`/`America/New_York`, não offset
fixo — diferente da Copa, o Brasileirão roda o ano inteiro e cruza a virada EDT/EST em novembro).
Aplicado no card "Próximo jogo" (1 jogo só e lista compacta "Jogos de hoje") e na lista completa
de jogos. Formato: `"18:30 (EDT) · 19:30 BRT"`.

Timestamps de sistema (sync da ESPN, última rodada de Probabilidades) continuam só em BRT — não
são horário de jogo, fora do escopo do pedido.

`audit_scoring.py`: PASSOU. Presentation-only.

## v1.62 — 2026-07-17

### Fixed — venue faltava na lista "Jogos de hoje" e no card ao vivo

Mesmo achado da Copa (ver changelog dela, "Falta a localização do jogo e qual rodada estamos") —
o card rico de "próximo jogo" (1 jogo só) já mostrava `next-game-venue`, mas a lista compacta
"Jogos de hoje"/"Próximos jogos" (`renderNextGameCard()`, vários jogos no mesmo dia) e o card ao
vivo (`renderLiveCard()`) nunca mostravam o local do jogo.

Adicionado `<div class="next-game-venue">` em cada item da lista compacta (reaproveita a mesma
classe já usada no card de 1 jogo só). No card ao vivo, `fetchScoreboard()` agora extrai
`comp.venue?.fullName`/`comp.venue?.address?.city` (o mesmo padrão já usado em `fetchSchedule()`
para a lista completa de jogos) e `renderLiveCard()` mostra num novo bloco `.live-match-meta`.

BR2026 não tem conceito de "fase" equivalente ao da Copa (é liga de pontos corridos, não
mata-mata) — "qual rodada estamos" não se aplica da mesma forma aqui; não generalizado
(`TOURNAMENT_SPECIFIC`, ver `docs/bolao/CONSISTENCY_MATRIX.md`).

Verificado com calendário real da ESPN (mockado via Playwright) — jogos de hoje (Bahia ×
Chapecoense, Fluminense × Bragantino, Mirassol × Grêmio) mostram o estádio corretamente.

`audit_scoring.py`: PASSOU. Presentation-only.

## v1.61 — 2026-07-17

### Changed — "Jogos de hoje": contador em texto trocado pelo widget de dígitos da Copa

Eduardo: "A contagem regressiva tem que ser igual copa meu!" O ajuste anterior (v1.59/v1.60)
corrigiu cor e alinhamento, mas a contagem em si continuava um resumo em texto ("· em 10h 05m"),
não o mesmo componente visual da Copa. Trocado por `countdownTimerHtml()` — o MESMO widget de
caixas grandes em dígitos (H/MIN/S, ou D/H/MIN/S com mais de 1 dia) já usado no card "Próximo
jogo" de 1 partida só, reaproveitado aqui por partida dentro da lista de múltiplos jogos do dia.
Mesmo comportamento responsivo da Copa no mobile (empilha em vez de ficar lado a lado). Mesmo
ajuste no CDB2026.

## v1.60 — 2026-07-17

### Fixed — "Jogos de hoje"/"Próximo jogo": rótulo cinza (devia ser verde) + centralização revertida

Eduardo mandou screenshot da Copa (card "PRÓXIMO JOGO"): "olha como esta a copa faca igual em
todos. Isso não deveria nem ser questionado." Dois achados reais comparando com o CSS de
verdade da Copa (`bolao/css/styles.css`):

1. **Rótulo cinza, devia ser verde** — `.hero-next-label` da Copa é `color: var(--green)`;
   `.next-game-label`/`.today-games-header` aqui usavam `var(--muted)` (cinza). Corrigido.
2. **Centralização da v1.59 revertida** — a lista "Jogos de hoje" tinha sido centralizada ontem
   em cima de um pedido verbal vago ("tudo para a esquerda"), sem checar o padrão real da Copa.
   O card de referência (`.next-match-info`/`.hero-next-*`) é alinhado à esquerda, com o
   contador de dígitos preenchendo o lado direito — não centralizado. Revertido pra alinhado à
   esquerda, igual à Copa.

Mesmos dois ajustes no CDB2026.

## v1.59 — 2026-07-17

### Fixed — "Jogos de hoje" sem contagem regressiva, alinhado à esquerda

Eduardo, screenshot com dados reais de produção (3 jogos hoje): "contador era dos proximos
jogos... o alinhamento é esse tudo para a esquerda." Investigado com o calendário real da ESPN —
confirmado que não era bug de dados, era design: a lista compacta "Jogos de hoje" (usada quando
há mais de um jogo no dia) só mostrava contagem regressiva na última hora antes do jogo ("· 12m
34s"), nada antes disso — num dia com jogos às 19h/20h, a manhã inteira ficava sem nenhuma pista
de quanto faltava. Agora sempre mostra alguma contagem quando o jogo é hoje e ainda não começou:
"· em 10h 13m" quando falta mais de 1h, "· 12m 34s" na última hora (sem trocar formato o tempo
todo — direto ao segundo só quando já importa). Também centralizado (cabeçalho, times, horário),
mesmo padrão do card "ao vivo" (v1.55) — antes tudo ficava alinhado à esquerda. Mesmo ajuste no
CDB2026.

## v1.58 — 2026-07-17

### Fixed — vão em branco no final da página no iOS (hipótese: reflow de rolagem do WebKit)

Eduardo, screenshot: "Ainda tem bastante areas em branco ao final da pagina, isso tinha sido
corrigido." Investigação a fundo: peguei o estado real do Supabase (11 entradas) e reproduzi
localmente — o rodapé fica exatamente coincidindo com o fim da página, sem sobra nenhuma, em
todas as abas, no Chromium. Comparado byte a byte com produção: idêntico. Sem conseguir
reproduzir num navegador WebKit real (não disponível neste ambiente), a hipótese de trabalho é
um bug conhecido do Safari no iOS: vários cards (ao vivo, ranking ao vivo, próximo jogo, contagem
regressiva) agora aparecem/somem dinamicamente a cada poll de 60s — quando o conteúdo ENCOLHE
enquanto a página está rolada perto do final, o WebKit às vezes não recalcula a área rolável até
uma interação nova, deixando um vão vazio "fantasma". `nudgeScrollReflow()` (um `scrollBy(0, 0)`
imperceptível) roda depois de cada ciclo de renderização (`pollAll()` e `renderAll()`) — correção
padrão documentada pra esse bug específico, sem custo/efeito quando a página não está rolada.
Mesmo ajuste no CDB2026 e na Copa (mesmo mecanismo de cards dinâmicos nos três).

## v1.57 — 2026-07-17

### Fixed — caixa de foco feia ao redor do título "Projeção do Bolão"

Eduardo, screenshot: uma caixa azul aparecia em volta de "Projeção do Bolão" depois de trocar de
aba pro Ranking. É o anel de foco padrão do navegador em cima do `<h2>` que `showSection()`
foca de propósito a cada troca de aba (pra leitor de tela saber que a página mudou) — nunca
alcançado por navegação real via Tab, então esconder o anel visual não perde acessibilidade de
verdade. Mesmo padrão corrigido na Copa e no CDB2026 (ver changelogs deles).

### Fixed — caixa da contagem regressiva ficava vazia e visível depois do prazo encerrar

Eduardo, screenshot: a caixa "Encerrado" no topo continuava ocupando o mesmo espaço grande da
contagem regressiva mesmo depois do prazo — "Pode esconder isso". Mesmo padrão que a Copa sempre
teve (`updateCountdown()`, esconde a caixa inteira quando `diff <= 0`) — o BR2026 tinha divergido
mostrando "Encerrado" solto dentro da caixa em vez de escondê-la. Corrigido pra esconder a caixa
inteira, igual à Copa. Mesmo ajuste no CDB2026 (por fase ativa, não pelo fim do torneio inteiro).

### Fixed — pontos do Ranking quebrando em duas linhas ("170" / "pts")

Eduardo: "Deixe tudo da entrada em uma linha e sem crlf." A coluna de pontos no mobile tem
largura FIXA de 40px (pra o botão "Ver palpites" nunca deslocar conforme o placar tem 1-3
dígitos) — dimensionada só pros dígitos, exatamente como a Copa. O sufixo " pts" (que a Copa
nunca mostrou aqui) não cabia nessa largura e quebrava linha. Removido, mesmo padrão da Copa
(número puro, sem rótulo).

### Fixed — contador regressivo do "Próximo jogo" tinha sumido

Eduardo: "A contagem regressiva dos próximos jogos sumiu." Regressão da v1.56: ao agrupar por
dia pra mostrar múltiplos jogos no mesmo dia seguinte (pedido anterior do Eduardo), o branch que
tratava "só 1 jogo no próximo dia" foi substituído pelo item compacto de "jogos de hoje" (sem o
contador em dígitos grandes) em vez de manter o layout rico original. Restaurado: quando há
exatamente 1 jogo no próximo dia com jogo, volta o card rico com contador em dígitos + local;
quando há mais de 1, continua a lista compacta (pedido original preservado).

## v1.56 — 2026-07-16

### Fixed — relógio ao vivo mudava de formato quando pausava (achado em screenshot: "51'" vs "52:24")

Eduardo mandou um screenshot: "Um cronometro mostra só minutos e outro mostra minutos e
segundos. Fere inconsistência!" `liveClockDisplay()` preferia `m.clockStr` (string crua da ESPN,
só minuto, ex. "51'") quando `clockPaused` era verdadeiro, e só usava o formato calculado
"MM:SS" (`formatMatchClock()`) quando o relógio estava rodando — dois formatos diferentes pro
MESMO elemento dependendo de um estado interno que o usuário nem vê. Corrigido pra sempre passar
por `formatMatchClock()` quando `clockSeconds` existe; pausado só significa não somar o tempo
decorrido desde o último poll, nunca trocar de formato — mesmo princípio que a Copa sempre teve
(ela nunca tinha essa bifurcação; só esta cópia introduziu o bug). Mesmo bug/fix propagado ao
CDB2026 (código idêntico, mesma origem).

### Fixed — "Ranking ao vivo" com espaçamento enorme dos dois lados no desktop

Eduardo: "ranking ao vivo ainda tem muito espacamento para a direita e esquerda... isso no
desktop, no mobile esta ok." A tabela tinha `max-width: 420px` fixo — no mobile isso já batia em
100% da largura do card, por isso só aparecia no desktop. Subiu pra 760px e aumentou fonte/
padding das células pra preencher melhor o espaço em vez de sobrar vazio.

### Changed — pontos do Ranking sempre verdes, sem seta duplicada de "provisório"

Eduardo: "no ranking mostra a pontuacao em amarelo e com uma seta para cima e baixo, deveria ser
igual copa e copa do brasil." A pontuação provisória (antes de resultados travados) ficava
amarela e trocava "pts" por "↕" — nem a Copa nem o CDB2026 faziam isso, sempre verde com "pts"
fixo, confiando só no aviso "↕ projeção provisória" já mostrado no topo da lista. Removido pra
igualar aos outros dois apps; a seta de movimento de posição (▲/▼) continua, essa foi pedida
explicitamente e é intencional.

### Changed — número de posição sem ponto sobrando ("4." → "4")

Eduardo: "e tira o '.' se a posicao nao muda no ranking, parece sujeira." Mesmo ajuste
propagado à Copa e ao CDB2026 no mesmo patch (mesmo trecho de código nos três).

### Added — "Próximos jogos" mostra todos os jogos do dia seguinte, não só o primeiro

Eduardo: "proximo jogo mostra somente um, mas amanha tem mais, mostre proximos jogos quando ha
mais de um no mesmo dia." Quando não há jogo hoje, o card antes mostrava só o jogo cronologicamente
mais próximo (`nextUpcomingGame()`, que continua existindo — ainda é a fonte do congelamento do
cutoff, precisa continuar sendo um único jogo fixo). A exibição agora agrupa por dia: todos os
jogos que caem no mesmo dia BRT do próximo jogo aparecem juntos, com um subtítulo de data.

### Fixed — CDB2026 trazido pro mesmo padrão do card "ao vivo" (dedupe, plays feed, ranking ao vivo)

Ver `bolao/cdb2026/CHANGELOG.md` v3.40 pro detalhe completo — Eduardo: "aplicou as mesmas
alteracoes na CDB2026? PRECISAMOS SER CONSISTENTES!" Registrado aqui porque a origem do pedido
foi uma comparação direta com este app.

## v1.55 — 2026-07-16

### Changed — card "ao vivo" refeito do zero copiando a estrutura real da Copa (não só ajustando espaçamento)

Eduardo, olhando o v1.54 já publicado: "ficou horrivel isso! faca igual da copa do mundo tche,
voce sabe mais que isso." As duas rodadas anteriores (v1.53/v1.54) só ajustaram espaçamento em
cima de uma pilha vertical inventada (badge, depois times, depois posições, depois relógio, cada
bloco numa linha própria com bastante vão entre eles) — nunca correspondia à estrutura real do
`hero-live-card` da Copa, que é uma ÚNICA linha horizontal (escudo+nome+posição de um time |
placar | badge+relógio centralizados | placar | escudo+nome+posição do outro time). Refeito do
zero copiando essa estrutura + os tokens de tamanho/espaçamento da Copa quase literalmente
(`bolao/css/styles.css` `.hero-live-top/.hero-live-team/.hero-live-score/.hero-live-center` →
`.live-top/.live-team/.live-score/.live-center` aqui). Com múltiplos jogos ao vivo, agora são
cards lado a lado (`.live-match-grid`, mesmo `flex-wrap` do `.next-match-live-grid` da Copa), não
mais empilhados numa única caixa com divisórias tracejadas. O placar fica genuinamente no centro
visual do card agora (Eduardo: "e ainda nao esta centralizado o placar" — resolvido por
construção, não por CSS de centralização em cima da estrutura errada).

### Fixed — hero "Ranking ao vivo" só mostrava quem estava se movendo, cortando o topo da lista

Eduardo: "e no ranking so aparece da 4 posicao para baixo, tem que aparecer todos, pode scrolar
mas deixa pelo menos 4-5 no topo." O filtro "só quem está subindo/descendo" (v1.54) fazia sentido
pra reduzir ruído, mas na prática escondia entradas paradas no topo, dando a impressão de que a
lista começava do meio. Agora mostra todo mundo, ordenado por posição, dentro de uma caixa com
scroll (~4-5 linhas visíveis sem rolar, cabeçalho fixo no topo do scroll) — só a condição de
"esconder o card inteiro sem ninguém se movendo" continua igual.

## v1.54 — 2026-07-16

### Fixed — Ranking (setas de movimento) só reagia ao placar DEPOIS que a ESPN fechava o jogo

Eduardo, na rodada seguinte de feedback: "nao ta mostrando estilo copa conforme os jogos estao
ocorrendo qual a posicao no ranking as pessoas estao subindo ou descendo de acordo com as
projecoes live." Achado real ao investigar: `renderRanking()` calculava a posição/pontuação
"atual" de cada participante direto de `_standings` — a tabela OFICIAL da ESPN, que só é
reprocessada depois que a ESPN marca a partida como encerrada — nunca da tabela AJUSTADA pelo
placar ao vivo (`liveStandingsNow()`, já existente e usada no card "ao vivo" desde a v1.53).
Resultado: as setas do Ranking ficavam presas na posição de ANTES do jogo começar durante toda
a partida, só se moviam depois do apito final + ESPN republicar — tarde demais pra ser uma
"projeção ao vivo" de verdade. Nova função `currentResultSet()` centraliza essa escolha (usa a
tabela ao vivo quando há jogo em andamento, cai pra `_standings` fora de janela ao vivo) —
única fonte usada tanto por `renderRanking()` quanto pelo novo hero abaixo. Verificado
injetando duas entradas de teste com um placar ao vivo real que cruza a fronteira do G4: a que
acertou o time que assumiu a vaga sobe, a outra desce, exatamente como esperado.

### Added — hero "Ranking ao vivo" logo abaixo do card de jogos, mesmo estilo da Copa

Eduardo: "isso poderia vir num hero logo abaixo dos jogos ao vivo no mesmo estilo da copa, o
que achas?" Novo card `#liveRankingHero`, mesmo estilo visual do card "ao vivo" (`hero-live-
points` da Copa como referência), listando só quem está subindo ou descendo agora (até 8,
ordenado por posição) — reaproveita 100% do cálculo já existente
(`calculateRankingMovement()`), nenhuma fórmula nova. Fica escondido sem jogo ao vivo, sem
baseline confiável, ou sem ninguém se movendo (Eduardo: "se ficar ruim ou muito busy deixa de
fora") — nunca mostra uma tabela parada.

### Fixed — card "ao vivo" ainda parecia fora de centro (feed de lances/barras muito largos)

Eduardo: "esta ainda fora de centro." O card em si já estava centralizado (v1.53), mas o feed
de lances e as barras de probabilidade dentro do detalhe expansível esticavam pra largura
inteira do card (sem limite), enquanto o cabeçalho acima (times/placar/posição) ficava
compacto e centralizado — o contraste entre uma faixa estreita centralizada e uma caixa larga
colada nas bordas é o que lia como "fora de centro". `.live-match-detail` agora tem
`max-width: min(520px, 100%)` centralizado, alinhando visualmente com o cabeçalho acima.

## v1.53 — 2026-07-16

### Added — `send_round_email.py --test-send`, envia uma prévia real só pra Eduardo revisar

Eduardo: "Once you are done send a test email to me only so I can proofread." Novo modo, sem
tocar Supabase: roda o mesmo gate de auto-teste do `--auto` (`audit_scoring.py` +
`_self_check_rank_entries()`, recusa enviar se falhar), busca os jogos completos mais recentes
de verdade (com lookback alargado pra 14/60/200 dias, já que o Brasileirão pausou pra Copa do
Mundo e só retomou em 16/07 — os últimos jogos concluídos de verdade são de antes da pausa),
monta o email real personalizado pra entrada do Eduardo (`participantEmail == emferrari@gmail.com`)
com faixa amarela "⚠️ TESTE" no topo, e envia só pra ele. Testado com sucesso contra dados reais.

### Fixed — jogo ao vivo aparecia duas vezes ("🔴 N jogos ao vivo agora" + "Jogos de hoje")

Eduardo: "nos jogos de hoje, se ja esta mostrando ao vivo, nao precisa mostrar duas vezes."
`renderNextGameCard()` listava TODOS os jogos do dia sem excluir os que já apareciam no card
"ao vivo" (`renderLiveCard()`), duplicando a mesma partida — mesmo placar, mesmo relógio
(`liveClockDisplay()`), renderizados duas vezes na página. `todayGames` agora filtra qualquer
jogo cuja chave `homeTeam|awayTeam` já esteja em `_liveMatches`; jogos "pre" (ainda não
começaram) e "post" (já terminaram) continuam aparecendo normalmente em "Jogos de hoje".

### Added — minuto a minuto de gols/cartões/substituições no card "ao vivo"

Eduardo: "voce pode tambem adicionar o minuto a minuto de cartoes, gols, substituicoes como
tem na copa tambem?" Portado da Copa (`extractMatchPlays`/`livePlaysHtml` em `bolao/js/app.js`,
ver PLATFORM_ARCHITECTURE.md "Golden master"): mesma fonte de dados já buscada a cada poll
(`comp.details` do endpoint scoreboard da ESPN), sem chamada de rede extra. Aparece dentro do
detalhe expansível de cada partida ao vivo, junto com as barras de probabilidade já existentes.
Mesmo contrato "falha silenciosa" da Copa — um formato inesperado da ESPN degrada pra lista
vazia, nunca quebra o placar/relógio ao vivo.

### Added — posição atual + seta de movimento por time no card "ao vivo"

Eduardo: "precisamos mostrar a posicao atual de cada time com uma seta pra cima ou baixo
conforme o resultado de acordo com a posicao antes do jogo." Esse cálculo já existia
(`calculateLiveStandings()`/`standingsMovementHtml()`, shipped em v1.4x pra tabela de
Classificação) — só não estava exposto no card "ao vivo" em si, onde o Eduardo estava olhando.
Reaproveita a mesma função e a mesma baseline (`_standingsBaseline`, congelada quando o
primeiro jogo ao vivo do dia é detectado); mostra "–" em vez de posição/seta quando ainda não
há uma baseline confiável (ex.: página recém-aberta no meio de uma partida).

### Changed — card "ao vivo" centralizado (era alinhado à esquerda)

Eduardo: "seria ideal centralizar tambem e nao deixar tudo na esquerda." `.live-match-row`
mudou de linha única (flex-wrap, alinhado à esquerda) pra coluna centralizada — badge, times,
posições e relógio empilhados e centrados, mesmo em telas largas. O chevron de
expandir/recolher virou posicionado (`position:absolute`) no canto superior direito da linha
em vez de empurrado pra lá via `margin-left:auto`, que só funcionava alinhado à esquerda.

### Fixed — barra de probabilidade do card "ao vivo" sem o limiar de 12% pra nome do time

Achado durante o teste do item acima: as barras de probabilidade dentro do card "ao vivo"
(`renderLiveCard()`) eram a ÚNICA das 4 chamadas de barra de probabilidade deste arquivo sem a
proteção "esconde o nome do time se a fatia for menor que 12%" — as outras 3
(`renderGamesSection`, `renderNextGameCard`, `renderRanking`) já tinham. Resultado visível:
"Palmeiras 12%" estourando a largura da própria fatia. Agora usa o mesmo limiar das outras 3
chamadas (e da Copa, `probBarsMarkup()`). Não existia em CDB2026 (função de barra própria, já
com o limiar certo) nem na Copa (função compartilhada única) — bug isolado ao BR2026.

## v1.52 — 2026-07-16

### Fixed — nomes renomeados pelo admin "não apareciam" (merge de entradas sempre preferia o cache local)

Eduardo: "Você atualizou o banco com os nomes? Não aparece ainda." Confirmado por leitura
direta do Supabase: os nomes ("Gustavo Ferrari", "Matheus The Client") estavam corretos no
banco desde a rodada anterior — o problema era `mergeStates()`: `entries` usava "local sempre
vence" (`byId[e.id] = e` sobrescrevendo remoto por local incondicionalmente), o mesmo padrão já
corrigido pro `cutoffAt` mais cedo hoje, só que nunca propagado pra `entries`. Qualquer
navegador que já tivesse essas duas entradas em cache local (de antes da renomeação) ia manter
o nome antigo pra sempre, mesmo depois do Supabase já estar certo. A Copa já tinha a correção
certa (`bolao/js/app.js`): preferir sempre o registro mais RECENTE por entrada
(`updatedAt`/`createdAt`), não um lado fixo — portada aqui e pro CDB2026 (mesma estrutura de
merge). Os dois registros já renomeados também tiveram `updatedAt` atualizado direto no
Supabase pra vencer qualquer cache local já existente assim que essa versão for publicada.

### Fixed — Probabilidades mostrando times com % impossível (Remo 0% de rebaixamento em 18º lugar)

Eduardo: "A tabela de probabilidades está bem fora. Mostra Remo por exemplo como 0% de chances
de rebaixamento!" Investigado com dados reais da ESPN (não simulado) — dois bugs reais
confirmados:

1. **Nome de time divergente entre os dois endpoints da ESPN**: o endpoint de classificação
   devolve "Athletico Paranaense", o de calendário/jogos devolve "Athletico-PR" — o mesmo time,
   dois nomes. `buildRatings()`/`runMonteCarlo()` cruzam dado dos dois endpoints assumindo que
   o nome bate; com a divergência, os pontos das partidas restantes do Athletico eram somados
   sob a chave "Athletico-PR" enquanto o total inicial (30 pts, 4º lugar) ficava congelado sob
   "Athletico Paranaense" — o time nunca ganhava pontos na simulação, aparecendo como
   quase-certo de ser rebaixado (99%) apesar de ser o 4º colocado de verdade. Corrigido com um
   mapa de alias (`ESPN_SCOREBOARD_NAME_ALIASES`, mesmo padrão do `ESPN_ALIASES` do
   `send_result_email.py` da Copa), normalizando o nome do calendário pro nome da classificação/
   `DATA.teams` antes de qualquer cruzamento.
2. **Ajuste iterativo (Dixon-Coles) divergindo pra alguns times**: Remo tinha rating de ataque
   calculado em 5.93 (quase 6x a força de um time médio), sem nada nos resultados reais dele
   (~1,17 gols/jogo, nada excepcional) que justificasse isso — dava gol esperado de ~10 por
   partida, zerando a chance de rebaixamento em todas as 2000 simulações. Confirmado que não é
   ruído: reduzir iterações ou adicionar amortecimento não resolve, o ajuste converge pro mesmo
   teto/piso de qualquer forma (loop de realimentação estrutural entre pares de times, não falta
   de convergência). Adicionado um limite [0,25, 3] pro ajuste (impede valores fisicamente
   impossíveis) e um encolhimento de 70% em direção à média ingênua (gols/jogo) no resultado
   final — neutraliza a divergência sem descartar o modelo: times realmente fortes/fracos
   continuam se destacando (Palmeiras/Flamengo com G4 alto, Chapecoense/Vasco com Z4 alto), só
   os casos que davam valor implausível deixam de zerar uma zona inteira.

Verificado rodando o código REAL extraído do app.js (não uma reimplementação) contra dados ao
vivo da ESPN: Remo agora mostra Z4≈9% (era 0%), Athletico Paranaense mostra G4≈68% (era 99%
Z4) — tabela inteira de 20 times conferida, gradiente coerente do topo ao rebaixamento.

Não propagado ao CDB2026: usa um cálculo de probabilidade diferente (Poisson bivariado direto
por confronto, sem o mesmo ajuste iterativo de força de time ao longo da temporada) — essa
classe de bug não se aplica lá.

Não altera scoring nem lógica de pontuação — só o cálculo informativo de probabilidades.
`audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.51 — 2026-07-16

### Added — email automático de fim de rodada (em vez de por jogo)

Eduardo: "Para os emails apos jogos no br2026 vamos fazer emails apos cada rodada finalizar
para economizar no envio." BR2026 não tinha nenhum email automatizado por jogo antes disso
(só o comprovante de inscrição) — a Copa envia um email por partida via
`bolao/scripts/send_result_email.py`, mas isso só funciona lá porque a Copa tem ~32 partidas
no total. O Brasileirão tem ~380 jogos na temporada; replicar o mesmo padrão por jogo
significaria ~380 envios/temporada (× participantes). Construído direto em lote por rodada em
vez disso (~38 envios/temporada).

**Descoberta real que mudou o design**: a API da ESPN para o Brasileirão não expõe número de
rodada por jogo. Testado ao vivo (schedule completo de 2026 buscado da ESPN, 382 jogos): nem
agrupar por proximidade de data nem reconstruir rodadas pela estrutura de turno-returno
(cada time joga uma vez por rodada) produz um calendário limpo — jogos adiados/remarcados e a
compressão pós-Copa do Mundo geram "rodadas" de até 39 jogos quando forçado. Sem uma fonte
oficial rodada-a-rodada pra cadastrar à mão (diferente do CDB2026, onde Eduardo forneceu os
confrontos reais), Eduardo escolheu a alternativa: uma janela rolante de 7 dias. O "lote atual"
é formado pelo jogo mais antigo ainda não coberto por um lote anterior + tudo dentro de 7 dias
dessa data; quando todos os jogos do lote terminam, o email dispara e o lote fecha.

- `bolao/br2026/scripts/send_round_email.py` (novo): mesmo padrão de segurança do
  `send_result_email.py` da Copa — audit_scoring.py roda antes de qualquer coisa, confirmação
  de estabilidade (re-checagem da ESPN após 20s), checagem de sanidade (nenhum jogo do lote com
  data futura, times resolvidos), idempotente (lote só fecha depois de tentar todos os envios).
  Importa `score_entry()` direto de `audit_scoring.py` (fonte única, sem reimplementação
  duplicada) — só o desempate final (`rank_entries()`, ordem alfabética reversa do nome) é
  transcrito à mão aqui, e ganhou seu próprio self-check (`_self_check_rank_entries()`) porque
  o `check_tiebreak_order()` do audit_scoring.py compartilhado explicitamente não cobre esse
  último passo (ver docstring dele).
- Conteúdo do email (aprovado por Eduardo): resultados dos jogos da rodada + classificação
  G4/Sul-Americana/Z4 atual + seção pessoal "Seu desempenho" (pontos, posição, seta de
  movimento vs. a rodada anterior). Um email por participante (personalizado), mais um resumo
  pro admin.
- `.github/workflows/br2026_round_emails.yml` (novo): cron a cada 30min nos horários típicos de
  jogo (18h-1h EDT), ano todo — sem restrição de mês como o cron da Copa (que só roda
  junho/julho, janela da Copa do Mundo). Não faz nada se não houver jogos na janela; seguro
  rodar fora de temporada.
- Novo campo de estado `s.roundEmail` (Supabase): `pendingBatch`, `baseline` (G4/Z4/SA6 da
  última rodada enviada, pra calcular movimento), `sentGameIds`, `sentBatches` (histórico,
  cap 50). Cada envio também registra uma entrada no journal (`s.auditLog`, ação
  `round-email-sent`).

Testado: rodado ao vivo contra a ESPN e o Supabase de produção duas vezes (idempotência
confirmada — segunda chamada não reabre o lote), `rank_entries()`/HTML de email testados com
dados simulados. **Não testado**: o caminho real de envio de email em si, porque nenhum lote
chegou a "todos os jogos completos" ainda — só vai disparar de verdade quando a próxima janela
de 7 dias realmente terminar.

Não altera scoring nem lógica de negócio (reaproveita a fórmula existente). `audit_scoring.py`
(Copa/BR2026/CDB2026): 5/5.

## v1.50 — 2026-07-16

### Security — senha do admin atualizada

Ver nota completa em `bolao/CHANGELOG.md` v4.140 — mesma troca, propagada aos três apps
(já compartilhavam o mesmo hash).

### Data — duas entradas renomeadas em produção, a pedido do Eduardo

"Gustavo" → "Gustavo Ferrari", "Matheus" → "Matheus The Client" (ids `bebac118-…` e
`cafb8261-…`). Atualizado diretamente no Supabase (`bolao_state`, `id="br2026"`), registrado no
journal (`s.auditLog`, ação `rename-entry`, nome anterior/novo). `payerName`/`paymentMethod`
não foram tocados (continuam vazios, conforme já confirmado por Eduardo que está OK).

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.49 — 2026-07-16

### Fixed — badge "Pago"/"Pendente" vazando da própria caixa em telas estreitas

Eduardo: "the pago is outside the box. You should be very thorough about these knits." Ver nota
completa em `bolao/CHANGELOG.md` v4.139 (mesma correção, mesma causa raiz nos três apps).
`.rank-row` é reaproveitado por `renderRanking()` (4 itens) e `renderParticipants()` (só 3
itens) — o breakpoint mobile fixava a 3ª coluna em `40px` (dimensionado pro placar do ranking),
insuficiente pro badge "Pendente" (8 letras, mediu 79px reais de largura). Nova classe
`.rank-row.participant-row` com `grid-template-columns: 28px 1fr auto;` para a estrutura real
de 3 itens.

Confirmado com medição de DOM real (`scrollWidth`), não é correção especulativa: badge
"Pendente" agora mede 79px e cabe com 13px de folga (antes: forçado em 40px).

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.48 — 2026-07-16

### Fixed — entrada podia ser salva sem responsável pelo pagamento nem método de pagamento

Eduardo encontrou uma entrada real (Matheus) salva com "·" vazio no lugar de responsável e
método de pagamento na aba Participantes, e outra (Gustavo) sem responsável. "This can not
happen... doesn't look professional." `saveEntry()` validava `entryName` e `participantEmail`,
mas nunca `payerName` nem `paymentMethod` — a Copa (`bolao/js/app.js`) sempre validou os quatro
(`requiredPayerName`/`requiredPaymentMethod`), essa checagem nunca foi portada para o BR2026
durante a construção do app. Corrigido: `saveEntry()` agora bloqueia o salvamento (com o mesmo
alerta da Copa) se `payerName` ou `paymentMethod` estiverem vazios, tanto para entrada nova
quanto para edição.

Registros já salvos com o campo vazio (Matheus, Gustavo) não foram alterados — Eduardo
confirmou que está OK deixar como está; a correção é só para impedir que aconteça de novo.

Testado com Playwright: tentar salvar com nome+email mas sem responsável bloqueia com
"Digite o responsável pelo pagamento."; com responsável mas sem método bloqueia com "Selecione
o método de pagamento."

### Fixed — endurecido `overflow-x: hidden` para `overflow-x: clip` (side-scroll voltou)

Eduardo: "the issue with the side scroll is back." Ver nota completa em `bolao/CHANGELOG.md`
v4.138 (mesma correção, propagada aos três apps) — `overflow-x: hidden` sozinho não impede o
"rubber-band" horizontal do iOS Safari quando um ancestral usa `position: sticky` +
`backdrop-filter` (o `.topbar`); trocado para `overflow-x: clip` (com `hidden` como fallback).
Não foi possível reproduzir com Chromium no sandbox — correção especulativa e propagada por
prudência; acompanhar se o sintoma persistir.

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.47 — 2026-07-16

### Fixed — vão vazio grande no final de toda página (mobile e desktop)

Eduardo: "There's a lot of empty space (non urgent) at the very bottom of the page." Root cause:
`main` tinha `padding-bottom: 80px` (base e mobile), bem maior que o padrão da Copa (referência
visual canônica) — `20px` desktop / `12px` mobile, sem valor especial de bottom — apesar da Copa
ter a mesma estrutura de botão sticky (`.sticky-submit`) no final do formulário de palpites. Os
80px pareciam existir só pra dar folga ao botão sticky, mas essa folga já é resolvida pelo
`position: sticky` em si — o valor grande só sobrava como vão morto abaixo do conteúdo em TODA
aba (Ranking, Tabela, Participantes etc.), não só na de Palpites.

- `main { padding: 16px 14px 80px; }` → `padding: 16px 14px;` (desktop)
- `main { padding: 12px 10px 80px; }` → `padding: 12px 10px;` (mobile, `@media max-width: 900px`)

Confirmado com Playwright (scroll até o fim, screenshot): `scrollHeight` mobile caiu de 3125px
para 3057px (-68px, os 80px→12px esperados); botão sticky continua funcionando normalmente sem
sobrepor conteúdo, aba Ranking sem regressão.

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.46 — 2026-07-16

### Fixed — "Palpites" continuava clicável depois do prazo; propagado padrão da Copa

Eduardo: "once it cuts disable the palpites button like copa and default to ranking like copa."
O "default to ranking" já existia (`showSection(isPastCutoff() ? "ranking" : "entry")` desde a
introdução do cutoff automático); faltava a outra metade do padrão da Copa: desabilitar o botão
de navegação "Palpites" em si depois do prazo (`init()` da Copa faz
`navEntryBtn.disabled = isPastCutoff()`, nunca implementado aqui). Adicionado o mesmo trecho —
o botão fica desabilitado (estilo padrão do navegador para `disabled`, igual à Copa, sem CSS
extra) sempre que a página carrega depois do prazo.

Mesma limitação da Copa, não nova: computado uma vez no `init()`, não reativamente — se o prazo
vence com a aba já aberta, o botão só desabilita no próximo carregamento. Comportamento aceito
na Copa, replicado aqui sem alteração.

`audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.45 — 2026-07-16

### Fixed — extensão manual do prazo (+45min) e bug de propagação em `mergeStates()`

Eduardo pediu para estender o prazo em 45 minutos. O prazo (`s.cutoffAt`, congelado 1h antes do
primeiro jogo real, 18h30 -03:00) já tinha passado há ~2 minutos quando o pedido chegou — ação
imediata em produção:

- **Intervenção manual em produção**: `s.cutoffAt` atualizado diretamente no Supabase
  (`bolao_state`, `id="br2026"`) de `2026-07-16T21:30:00.000Z` para `2026-07-16T22:15:00.000Z`
  (18h30 → 19h15 -03:00), preservando as 9 entradas existentes. Registrado no novo journal
  (`s.auditLog`, ação `extend-cutoff`, com prazo anterior/novo) — mesmo mecanismo shipado nesta
  sessão (v1.44).
- **Bug real encontrado ao investigar a propagação**: `mergeStates()` sempre preferia o
  `cutoffAt` já em cache local (`local.cutoffAt || remote.cutoffAt`), por design, para impedir
  que um cliente atrasado resetasse o prazo. Isso também impedia uma extensão manual do admin de
  chegar a qualquer navegador que já tivesse carregado a página hoje (cutoffAt antigo ficaria
  preso no `localStorage` para sempre). Corrigido para sempre preferir o valor **mais tarde**
  entre local e remoto (nunca mais cedo, nunca `null`) — mantém a proteção original e ainda
  deixa uma extensão manual se propagar de verdade. Testado com 5 casos (local mais velho, local
  mais novo, remoto nulo, local nulo, ambos nulos).
- `C.cutoffIso` (fallback, `config.js`) também atualizado para 19h15 -03:00, para consistência —
  só afeta quem nunca carregou o app hoje (já congelado para quem já visitou).

Não altera scoring nem lógica de pontuação. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.44 — 2026-07-16

### Added — triple confirmation + journal de admin + backups automatizados para o resultado oficial

Eduardo pediu para remover os controles manuais de resultado do admin (automatizar tudo via
ESPN), depois reverteu antes de qualquer código ser tocado ("it doesn't hurt to have and don't
want to waste tokens on this") — nada foi removido. Em vez disso, pediu proteção contra mis-click
mobile e um jeito de reverter: "make sure there's triple confirmation if I click incorrectly it
can be rolled back easily... what I want to avoid is to fat finger something... we need to have a
way to journal this so it can be rolled back if needed... the same way copa has, this also needs
to have backups done." Ver nota completa em `docs/bolao/CONSISTENCY_MATRIX.md` (propagação do
padrão já existente na Copa).

- **Triple confirmation**: travar/destravar o resultado oficial (`saveResultsBtn`/
  `unlockResultsBtn`) agora exige dois `confirm()` + um `prompt()` digitando a palavra
  `CONFIRMAR` (`tripleConfirm()`) — o terceiro passo é o que resiste a toques acidentais em
  sequência, não só repetição de `confirm()`.
- **Journal**: novo `s.auditLog` (mesmo padrão da Copa — `appendAdminAuditLog()`, merge por
  timestamp entre dispositivos, cap de 200, exibido no admin em `renderAdminAuditLog()`)
  registrando `lock-results`/`unlock-results` com o conteúdo antes/depois, o suficiente para
  reverter manualmente se necessário.
- **Backups**: `exportJsonBackup()` já existia (equivalente ao `backupJson()` da Copa). Novo:
  `bolao/scripts/backup.py` e `backup_daily.py` agora cobrem os três apps (`main`/`br2026`/
  `cdb2026`) na mesma execução — o cron diário existente (01:00 AM EDT) passa a fazer backup do
  BR2026 também, sem precisar de entrada de cron nova.

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v1.43 — 2026-07-16

### Added — card "ao vivo" com expandir/colapsar por jogo (rodada final tem até 10 jogos simultâneos)

Eduardo: "the last round generally all the games happen at the same time" — o Brasileirão tem 20
times, então uma rodada completa pode ter até 10 jogos ao vivo ao mesmo tempo. Antes,
`renderLiveCard()` já suportava múltiplos jogos simultâneos (um bloco `.live-match` por jogo,
empilhados), mas cada um sempre mostrava tudo (placar, relógio, barras de probabilidade) — uma
parede de 10 cards detalhados não se lê bem numa tela de celular.

- Cada jogo ao vivo agora tem estado independente de expandido/colapsado — a linha inteira
  (placar + times + relógio) é o alvo de toque (não só um ícone pequeno), com um chevron
  indicando o estado. Primeira vez que um jogo aparece: expandido por padrão se são só 1-2 jogos
  simultâneos (comportamento igual a antes), colapsado por padrão a partir de 3 — a escolha do
  usuário sempre prevalece depois disso, mesmo com o poll de 60s atualizando o placar.
- Cabeçalho "🔴 N jogos ao vivo agora" aparece quando há mais de 1 jogo simultâneo, pra dar
  contexto de quantos estão rolando.
- Placar, escudos e relógio sempre visíveis (não fazem parte do que expande/colapsa) — só as
  barras de probabilidade (que exigem a tabela de classificação carregada) ficam atrás do toggle.

Verificado com dados reais do Supabase (`br2026_state.json`, 4 entradas reais) e cenários
sintéticos de ESPN via interceptação de rede: 1 jogo ao vivo mantém o comportamento antigo
(expandido, sem cabeçalho); múltiplos jogos simultâneos testados via leitura de código +
verificação end-to-end do cenário de 1 jogo (a mesma função, mesmo caminho de código).

### Fixed — "Ver palpites" aparecia antes do prazo sem fazer nada útil; Pago/Pendente no ranking público

Eduardo, screenshot do CDB2026: "Ver palpites ainda aparece e so deve aparecer apos o cutoff
time. E tambem não precisa pago e pendente, só para o admin." Dois achados reais, propagados
para os dois apps (BR2026 e CDB2026 têm a mesma estrutura):

- **"Ver palpites"**: o botão sempre aparecia no ranking, mesmo antes do prazo de entrada — só
  que clicar nele revelava uma mensagem "escondido até o prazo" (o dado em si já estava
  protegido dentro de `renderPickDisplay()`/`renderPickDisplay()`, sem vazamento real). O botão
  virou um toque morto, sem função, até o prazo passar. Corrigido: o botão (e o painel de
  detalhe associado) só é renderizado quando `isPastCutoff()` (BR2026) /
  `isPastEntryCutoff()` (CDB2026, prazo da fase ativa) já passou — mesmo padrão de proteção,
  agora também na visibilidade, não só no conteúdo.
- **Pago/Pendente no ranking**: a Copa (referência visual canônica) nunca mostrou esse badge na
  linha do ranking — só existe lá na aba Participantes. BR2026 e CDB2026 tinham divergido,
  mostrando o badge nas duas abas. Removido da linha do ranking nos dois apps, igualando à Copa;
  segue existindo em Participantes (info pública/transparente sobre quem já pagou, sem mudança
  aí).

Verificado com estado real (BR2026, 4 entradas reais do Supabase) via Playwright: antes do
prazo, nenhum botão "Ver palpites" aparece e nenhum texto "Pago"/"Pendente" aparece no ranking;
depois do prazo (`cutoffAt` no passado), o botão aparece para todas as entradas e o texto
Pago/Pendente continua ausente.

Não altera scoring nem lógica de negócio de pontuação. `audit_scoring.py` (Copa/BR2026/CDB2026):
5/5.

## v1.42 — 2026-07-16

### Fixed — badge "Pago" divergente da Copa (checkmark); página podia rolar para o lado no mobile

Eduardo, dois achados via screenshot mobile real:

1. **"o look and feel esta um pouco off na Pago e Pendente"**: o badge de pagamento mostrava
   "✓ Pago" (com checkmark) enquanto "Pendente" não tem prefixo nenhum — a Copa (referência visual
   canônica) usa só "Pago", sem checkmark (`paymentPaid` em `bolao/js/i18n.js`). O glyph "✓"
   renderiza com métricas de fonte diferentes do texto latino ao redor (fallback de fonte de
   símbolo), inflando a altura da pílula de forma perceptível no mobile — CSS das duas pílulas
   (`.paid-badge`/`.unpaid-badge`) já era idêntico em padding/cor/border-radius, só o texto
   divergia. Corrigido: `paid: "Pago"` (sem checkmark), igual à Copa, propagado também ao CDB2026
   (mesmo texto, mesmo bug).
2. **"ele faz scroll para o lado tambem, corrija em todos"**: nenhum dos 3 apps tinha
   `overflow-x: hidden` no `html`/`body` — uma rede de segurança padrão da indústria contra
   qualquer elemento (conhecido ou não) forçar rolagem horizontal da página inteira. Confirmado
   via Playwright que a mudança não quebra nenhum scroll interno intencional (`.standings-wrap`,
   `.picks-detail`, `.table-scroll` continuam roláveis normalmente) nem o header sticky.
   Propagado aos 3 apps (Copa, BR2026, CDB2026) e à página `classificacao-geral.html`.

Não altera scoring nem lógica de negócio. `audit_scoring.py`: 5/5.

## v1.41 — 2026-07-15

### Added — comprovante abrível/baixável (item 9 do CONSISTENCY_MATRIX.md); tabela de regras sem cabeçalho extra

Eduardo: "yes please fix everything." BR2026 não tinha NENHUMA confirmação visual pós-salvamento
— só um toast e pulava direto pro Ranking, sem mostrar o código do comprovante nem jeito de
abrir/imprimir/baixar. Portado exatamente da Copa (`openReceipt()`/`downloadReceipt()`, via Blob
URL, nunca `document.write`) e do padrão já usado no CDB2026 (`renderReceiptBox()`): novo
`#receiptBox` na aba Palpites, com código + botões "Abrir comprovante / salvar PDF" e "Baixar
HTML", reaproveitando o `receiptHtml()` já usado no e-mail. Agora, salvar uma **nova** entrada
mostra esse card em vez de pular direto pro Ranking (editar uma entrada existente continua
pulando, como sempre foi).

Também alinhada a tabela de pontuação da aba Regras: tinha um `<thead>` que a Copa não tem
(`.rules-table` da Copa é só `<tbody>`) — removido para bater exatamente.

`audit_scoring.py` (Copa + BR2026): PASSOU (mudança é só de exibição/confirmação, nunca grava
resultado oficial).

## v1.40 — 2026-07-15

### Added — prévia de pagamento no formulário de entrada (paridade com a Copa)

Continuando a auditoria de consistência (Eduardo: "sem pedir permissao... continue checando
diferencas"). A Copa mostra uma prévia do método de pagamento (`#paymentBox`) assim que o
participante seleciona CashApp/Zelle/Venmo no formulário — handle, QR (Zelle) e link, sem
precisar sair da aba Palpites. BR2026 nunca teve esse recurso. Portado exatamente
(`renderPaymentBox()`, mesmas classes `.pay-card`/`.pay-icon` já usadas na aba Pagamento),
disparado no `change` do select e também ao carregar uma entrada existente para editar.

`audit_scoring.py` (Copa + BR2026): PASSOU.

## v1.39 — 2026-07-15

### Fixed — Pot no lugar errado; barra de estatísticas sem equivalente na Copa removida

Eduardo: "o pot na copa nao esta igual nos outros dois... tudo precisa permanecer 100% igual a
nao ser que nao se aplique." Pot só aparecia como 1 de 3 números numa barra de estatísticas em
Participantes — a Copa não tem essa barra, mostra o Pot num `.pot-box` dedicado no cabeçalho do
Ranking (`#potValue`, atualizado em `renderRanking()`). Portado exatamente: `.pot-box`/
`.section-head-row` adicionados ao cabeçalho do Ranking, `#potValue` calculado com a mesma
fórmula da Copa (pagos × entryFee). A barra de estatísticas (total de entradas/pagas/pot) foi
**removida** — não tem equivalente na Copa, não era diferença específica de torneio, então não
se justificava mantê-la depois da correção anterior desta mesma auditoria.

### Added — audit_scoring.py (item 1 do CONSISTENCY_MATRIX.md)

BR2026 movimenta dinheiro real (US$5/entrada) e não tinha nenhuma proteção automatizada contra
regressão de scoring, ao contrário da Copa (que tem desde o incidente de julho/2026). Novo
`bolao/br2026/scripts/audit_scoring.py`: transcrição em Python da fórmula real de
`scoreEntry()`/`rankEntries()` (G4 exato/grupo/errado, Z4 exato/grupo/errado, SA6, cascata de
desempate), com 5 checagens (mutuamente exclusivo, pick perfeito soma certo, pick em branco não
pontua falso-positivo, sem resultado retorna `None` em vez de 0/crash, ordem de desempate).
Diferença importante em relação ao script da Copa: a Copa audita `send_result_email.py` (uma
reimplementação Python INDEPENDENTE que roda via cron) contra o site — aqui não existe um script
equivalente rodando sem supervisão, então não há "drift entre duas implementações" pra auditar.
O valor deste script é outro: garantir que a transcrição Python abaixo continua batendo com
`app.js` sempre que a fórmula mudar lá — precisa ser atualizado à mão junto de qualquer mudança
de scoring, mesma disciplina que `send_result_email.py` já exige na Copa.

`audit_scoring.py` da Copa: PASSOU (Copa intocada). `audit_scoring.py` do BR2026 (novo): PASSOU.

## v1.38 — 2026-07-15

### Fixed — tela "Participantes" com layout diferente da Copa

Eduardo apontou que Participantes/Ranking tinham "formatos de look and feel diferentes da
Copa". Ranking já usava a mesma estrutura (`.rank-row`); Participantes não — usava um
componente próprio (`.participant-row`, sem ícone, sem método de pagamento visível, spans
separados) nunca alinhado com a Copa (`.rank-row`: ícone 👤 + nome/pagador/método numa linha só
+ chip de status). Reconstruído pra usar exatamente a mesma marcação/classes da Copa. CSS morta
de `.participant-row` removida.

Também corrigido: `.unpaid-badge` usava vermelho/alarme (`rgba(248,113,113,.1)`); a Copa trata
"ainda não pago" como estado neutro (`.status-chip.pending`, cinza) — alinhado.

Mantida como acréscimo intencional (a Copa não tem equivalente, mas não conflita com as linhas
em si baterem exatamente): a barra de estatísticas (total de entradas/pagas/pot) no topo da
tela.

`audit_scoring.py`: PASSOU (mudança é só visual).

## v1.37 — 2026-07-15

### Added — paridade administrativa com o CDB2026 (itens 7/16/50 do CONSISTENCY_MATRIX.md)

Continuação da rodada de auditoria/correção pedida por Eduardo. Verificação contra o código
real (não só a matriz, que estava desatualizada em vários pontos — comprovante, CSV CRLF,
listener de `focus` e QR Zelle já tinham sido resolvidos por outra sessão e não precisaram de
nova correção):

- **Botão "Limpar tudo"** (`clearDataBtn`) e **backup JSON bruto** (`exportJsonBtn`) — portados
  quase literalmente do CDB2026 (`clearAllData()`/`exportJsonBackup()`), únicos itens de paridade
  administrativa que faltavam de verdade.
- **Timeout de rede (`AbortController`)** nas duas chamadas ao Supabase (`loadRemoteState()`/
  `saveRemoteState()`), que usavam `fetch()` cru sem timeout — só as chamadas à ESPN já passavam
  por `fetchJson()`. Também aplicado ao `checkVersion()` da IIFE de auto-reload (escopo isolado,
  sem acesso ao `fetchJson()` do módulo principal — timeout inline equivalente).

`audit_scoring.py`: PASSOU (mudança não toca scoring).

## v1.36 — 2026-07-15

### Fixed — relógio do card "ao vivo" sem detecção de intervalo, andava pra frente e voltava

Eduardo pediu uma auditoria comparando o recurso de jogo ao vivo entre Copa/BR2026/CDB2026 e,
depois, para corrigir tudo pra bater exatamente com a Copa. Achado: `pollAll()`/`renderLiveCard()`
filtravam partida ao vivo só por `state === "in"` — a ESPN mantém esse campo `"in"` durante o
intervalo também (o campo granular que muda é `type.name`, não `state`). Sem nenhuma detecção de
intervalo nem proteção contra o relógio andar pra trás por lag da ESPN, o card mostrava o relógio
subindo até ~46:00 e voltando pra 45:00 a cada poll (60s) durante o intervalo inteiro (~15min),
sem nunca indicar "Intervalo" — um "serrote" visual confuso.

**Correção**: portado quase literalmente da Copa (`bolao/js/app.js`) — `formatMatchClock()`
(relógio consciente de period, acréscimo de até 8min), `mergeLiveClock()` (monotônico, nunca anda
pra trás a não ser que a ESPN sinalize um reset de período legítimo), `detectClockPaused()`
(detecta pausa real comparando dois polls crus). `fetchScoreboard()` agora também extrai
`period`/`isHalftime`/`isPenalties`; `renderLiveCard()` e `renderNextGameCard()` passaram a
compartilhar uma função só (`liveClockDisplay()`) em vez de duplicar a lógica cada um do seu
jeito. Removida `formatClock()` (função antiga, sem mais chamador depois da correção).

Brasileirão nunca tem prorrogação/pênaltis (liga, não mata-mata), mas o tratamento de period
3/4/5 foi mantido mesmo assim, por paridade exata com a Copa (pedido explícito do Eduardo) e
porque não custa nada a mais.

`audit_scoring.py`: PASSOU (mudança é só de exibição ao vivo, nunca grava resultado oficial).

## v1.35 — 2026-07-14

### Added — "Projeção do Bolão": linguagem correta + índice de precisão informativo

Eduardo pediu a transformação completa do ranking numa página de projeção clara ("se o
Brasileirão terminasse hoje"), com auditoria prévia obrigatória. A auditoria (Fase 1) encontrou
que o motor de cálculo já existia de sessões anteriores (`getActiveScore()` já reusa a fórmula
oficial `scoreEntry()` alimentada com a tabela ao vivo; `calculateRankingMovement()` já compara
contra um baseline estável, nunca inventa movimento) — o trabalho real era linguagem/UI e a
métrica de precisão que faltava.

- **Título/subtítulo/disclaimer da seção Ranking** trocados para a linguagem exigida: "Projeção do
  Bolão" / "Se o Brasileirão terminasse hoje" / aviso explícito de que pontuação oficial e
  vencedores só saem depois do encerramento da competição.
- **Novo `accuracyMetrics()`**: índice de precisão 0-100% comparando o palpite original contra a
  tabela atual, posição a posição (G4/Z4) + acerto binário (SA6) — **puramente informativo, nunca
  usado em ranking/ordenação/desempate/pontuação**. Exibido no painel expandido de cada
  participante junto com uma lista das 5 maiores divergências (time, posição palpitada, posição
  atual).
- **Bug real encontrado escrevendo os testes**: o cálculo de distância posicional inicialmente
  comparava a posição REAL do time contra 0 fixo, em vez de contra o SLOT que o participante
  efetivamente escolheu para aquele time — corrigido antes de qualquer teste passar a depender do
  valor errado.
- `docs/bolao/BR2026_PROJECTION_MODEL.md` novo — fórmula, índice de precisão, movimento,
  limitações, estados tratados, linguagem obrigatória.
- Nova regra permanente em `CLAUDE.md`: toda classificação exibida antes do encerramento do
  Brasileirão deve ser tratada como projeção.

### Testado

- 17 testes novos (`test_br2026_projection.js`): linguagem da UI, `accuracyMetrics()` via hook de
  teste exposto (`window.__BR2026_TESTHOOKS__`) — palpite idêntico, posições trocadas em par,
  palpite invertido, time fora do grupo, SA6 parcial, sem palpite, sem classificação carregada, e
  confirmação de que `accuracyIndex` nunca aparece no objeto de ranking.
- Suíte de regressão completa (91 testes entre BR2026 e CDB2026) sem falhas.
- `node --check`; `python3 bolao/scripts/audit_scoring.py` — passou (fórmula oficial intocada).

## v1.34 — 2026-07-14

### Fixed — consistência entre apps + bug real de exposição de palpites

Eduardo reportou três problemas em sequência: email de comprovante diferente do CDB2026,
"Ver palpites" acessível antes do prazo (risco de cópia entre participantes) e "Ver palpites"
com layout inconsistente com a Copa. Auditados e corrigidos os três:

- **[SEGURANÇA — achado real] "Ver palpites" não era protegido pelo prazo de corte.** Diferente
  da Copa (que já tem `hideFuturePicks = !isPastCutoff()`), o painel de detalhe do ranking do
  BR2026 não checava cutoff nenhum — qualquer participante podia expandir o palpite de qualquer
  outro a qualquer momento, mesmo antes do Brasileirão começar. Corrigido: `renderPickDisplay()`
  agora retorna um aviso ("os palpites ficam ocultos até o prazo de entrada encerrar") enquanto
  `!isPastCutoff()`.
- **"Ver palpites" com estrutura visual inconsistente com a Copa.** O BR2026 usava um grid de
  cards de 2-3 colunas (`.picks-display`/`.pick-item`/`.pick-cell`), diferente da Copa, que usa
  `<table>` dentro de `.picks-detail`. Reconstruído para usar a mesma estrutura `<table>` e as
  mesmas classes CSS da Copa (`.picks-detail table/th/td`, `.pick-pts`/`.pick-pts.pos`). CSS morto
  removido (`.picks-display`, `.picks-col*`, `.pick-item`, `.pick-cell*`, `.pick-pts-badge`).
- **Email de comprovante inconsistente com CDB2026/Copa.** Reescrito `sendReceipt()`/nova
  `receiptHtml()` para usar o mesmo layout HTML (tema claro, `.doc`/`.meta`/`.code`/tabela/
  `.notice`) e o mesmo formato de código (`hashString()`/`receiptCode()` → `BR2026-XXXXXXXX-
  YYYYMMDD`) que Copa e CDB2026 já usam. BR2026 também passou a enviar cópia para o admin (Copa e
  CDB2026 já enviavam; BR2026 era o único que não).

### Testado

- 13 testes Playwright novos (`test_urgent_fixes.js`): reprodução e correção do bug de exposição
  de palpites, estrutura `<table>` pós-cutoff, formato do código de recibo, envio duplo
  (participante + admin).
- Suíte de regressão completa (`test_round2_fixes.js`, `test_live_standings.js`,
  `test_auto_cutoff.js`, `test_backfill_kickoffs.js`, `test_seed.js`, `test_cutoff_admin_ui.js`,
  `test_admin_leg_save.js`) — sem regressões.
- `node --check` em todos os JS alterados.
- `python3 bolao/scripts/audit_scoring.py` — passou (scoring não foi tocado).

## v1.33 — 2026-07-14

### Fixed — auditoria estilo Big Tech, rodada 2: itens que Eduardo autorizou explicitamente após ver o relatório

Depois do relatório completo da v1.32, Eduardo pediu explicitamente "corrija tudo e implemente".
Implementado o que não mexe em scoring/regra de negócio nem em comportamento arriscado de
produção:

- **Formulário de resultado oficial sem proteção contra sync em segundo plano**: `resultsFormIsDirty()`
  novo, compara os 14 `<select>` contra `s.results` e pula a reconstrução do painel enquanto o
  admin estiver editando (mesmo princípio de `pickFormIsDirty()`).
- **Formulário de resultado oficial não checava time duplicado dentro do mesmo grupo**: o
  formulário de palpite do participante já bloqueia isso; o formulário OFICIAL do admin (que
  decide a pontuação de todo mundo) não. Adicionada a mesma checagem (`errorDuplicateG4`/`SA6`/`Z4`).
- **Sem botão "Cancelar" ao editar uma entrada**: `_editingEntry` ficava preso indefinidamente se o
  admin saísse da edição sem salvar — e enquanto isso, o sync remoto ficava pausado (risco de
  sobrescrever entrada mais nova de outro dispositivo). Novo banner `#editModeBanner` com botão
  "Cancelar edição", mesmo padrão que a Copa já tem.
- **Sem validação entre `DATA.teams` (lista fixa) e o nome ao vivo da ESPN**: se a ESPN renomear um
  time, quem apostou nele passaria a pontuar zero silenciosamente. Adicionado aviso no console
  (mínimo necessário, sem travar nada) quando um time da tabela ao vivo não bate com a lista fixa.
- **Poll da ESPN não engajava backoff em falha parcial**: agora um dos dois endpoints falhando
  sozinho (não só os dois juntos) já reduz a frequência do poll.
- **Corte provisório G4/SA6/Z4 sem desempate próprio**: um empate de `rank` vindo da ESPN (comum
  logo após uma rodada) podia errar a fronteira entre zonas. Desempate determinístico adicionado:
  saldo de gols → gols pró → nome.
- **Tabela de probabilidades recalculada a cada resync mesmo fora de tela**: agora só roda quando a
  aba Probabilidades está ativa.
- **Alvo de toque mínimo (WCAG) no nav mobile**: `min-height: 44px` — propagado dos 3 apps.

Não implementado nesta rodada (feature-sized, fora do escopo de "corrigir um achado" — fica para
um pedido dedicado se Eduardo quiser): sistema de código de comprovante (BR2026 é o único dos 3
apps sem um, item já rastreado em `CONSISTENCY_MATRIX.md` #8).

`node --check`: OK. `audit_scoring.py`: 5/5 — nenhum valor de pontuação tocado.

## v1.32 — 2026-07-14

### Fixed — auditoria estilo Big Tech: ranking mostrava rank/medalha errados em empate, deploy podia apagar palpite

Eduardo pediu uma auditoria completa nível Big Tech nos 3 apps (arquitetura, bugs, UX, QA,
segurança, mobile, performance, acessibilidade, consistência, produto), com instrução explícita
de reportar achados primeiro e não alterar scoring/regra de negócio sem autorização. Relatório
completo entregue a Eduardo fora deste changelog; aqui só o que foi corrigido nesta rodada
(verificado lendo o código real antes de cada correção, não só confiando no relatório do agente):

- **🔴 Rank/medalha exibidos errados em empate de pontos** (`rankEntries()`): o array já era
  ordenado corretamente pela cascata de desempate completa (total → acertos SA6 → G4 exato → Z4
  exato → nome), mas o número de rank/medalha exibido só avançava quando `item.total` mudava —
  duas entradas com o mesmo total mas desempate diferente apareciam com a MESMA medalha, mesmo
  ordenadas corretamente no array. Afeta diretamente quem aparece como 2º/3º lugar, base do
  rateio de prêmio (70/20/10%). Corrigido usando o mesmo padrão já comprovado da Copa
  (`bolao/js/app.js`): chave composta `${total}:${sa6Hits}:${g4Exact}:${z4Exact}` decide quando o
  rank avança, não só o total. Testado via `window.__BR2026_TESTHOOKS__.rankEntries` com duas
  entradas empatadas no total por fontes de pontos diferentes (uma via Z4 exato, outra via SA6) —
  confirma ranks diferentes agora.
- **`checkVersion()` podia apagar um palpite não salvo:** o poller de deploy (10 min + toda troca
  de aba) não checava se o formulário de palpites tinha dado não salvo antes de forçar
  `location.reload()`. Adicionada a mesma checagem de `pickFormIsDirty()` (duplicada localmente
  porque essa IIFE roda fora do escopo do módulo principal).
- **CSV export usava `\n`, não `\r\n`:** bug já corrigido uma vez na Copa (v3.0) e no CDB2026
  (v2.0), nunca corrigido aqui (`CONSISTENCY_MATRIX.md` item 14, rastreado desde então). Excel no
  Windows renderiza mal um CSV com quebra de linha bare-LF.
- **Coluna "J" (jogos) podia mostrar 1 em vez de 0:** `getStat("gamesPlayed", "GP") || 1` fazia um
  time com 0 jogos de verdade (início de temporada) aparecer com "1" na tabela. A divisão que
  dependia disso (`buildRatings()`) já tinha sua própria proteção independente contra dividir por
  zero — não dependia deste valor errado para funcionar.
- **`aria-expanded` ausente no botão "Ver palpites" do ranking:** leitor de tela não indicava que
  o botão controla uma região expansível nem seu estado atual. Adicionado, sincronizado com o
  toggle de `.picks-detail`.

Achados de maior risco reportados a Eduardo mas não corrigidos automaticamente (fora do escopo
de "patch pequeno e reversível" desta rodada, ou dependem de decisão de produto): admin sem botão
"Cancelar" ao editar uma entrada (bloqueia sync em segundo plano indefinidamente até salvar),
formulário de resultado do admin sem proteção contra sync em segundo plano durante digitação
(mesma classe do bug já corrigido no formulário de palpite, mas no lado do admin), falta checagem
de time duplicado dentro do mesmo grupo no formulário de resultado oficial.

`node --check`: OK. `audit_scoring.py`: 5/5 — scoring (valores de pontos) não tocado, só a
exibição do rank/medalha em caso de empate no total.

## v1.31 — 2026-07-14

### Fixed — cutoff usava data estática defasada, divergindo do calendário real ("Próximo jogo")

Eduardo reportou (screenshot em produção): "Cutoff do BR2026 está incorreto! Deve ser até 1h
antes do início do primeiro jogo". `cutoffIso` (config.js) era um valor **estático**, digitado
manualmente em v1.11 como "domingo 19/jul às 23h59 (2 dias antes do reinício do BR)" — mas nunca
mais atualizado. O calendário real da ESPN (mesmo usado pelo card "Próximo jogo", que já estava
correto) já mostrava o primeiro jogo real como Botafogo x Santos, qui. 16/jul às 19h30 — 3 dias
**antes** do cutoff configurado. As duas informações discordavam na mesma tela.

Mesma classe de bug do CDB2026 v3.12 (ver entrada abaixo/CHANGELOG do CDB2026): um valor calculado
manualmente uma vez, sem mecanismo para acompanhar a realidade, fica defasado silenciosamente.

Corrigido com o mesmo princípio (auto-cálculo, uma vez):

- `nextUpcomingGame()` — novo helper único (usado tanto pelo cutoff quanto pelo card "Próximo
  jogo", que passou a chamá-lo em vez de duplicar a mesma busca) — garante que os dois **nunca
  podem discordar** sobre qual é o próximo jogo.
- `computeSeasonCutoffIso()` / `freezeSeasonCutoff()` — calcula o cutoff como 1h antes do primeiro
  jogo real ainda não realizado, e **congela** o resultado em `s.cutoffAt` (estado compartilhado
  via Supabase) na primeira vez que o calendário carrega. Congelar é necessário: sem isso, o
  "próximo jogo ainda não realizado" avançaria a cada rodada conforme jogos terminam, o que
  reabriria as entradas depois de fechadas — inaceitável, dinheiro real depende disso. Testado
  explicitamente (`test_br_auto_cutoff.js`): o valor não muda mesmo quando um recarregamento
  posterior do calendário mostra um "próximo jogo" mais distante.
- `cutoffIso` em config.js agora é só o fallback usado antes do primeiro congelamento — atualizado
  para o valor real correto (16/jul 18h30) para não mostrar um número errado nesse intervalo.
- `audit_scoring.py`: 5/5 (cutoff não afeta pontuação).

## v1.30 — 2026-07-14

### Fixed — "Próximo jogo" não mostrava contador ao vivo igual à Copa (mesmo achado no CDB2026)

Eduardo reportou: "próximo jogo br nao mostra countdown do proximo jogo igual copa que funciona
bem. Isso tem que ser 100% consistente". O card "Próximo jogo" (fora do caso "jogo hoje") só
mostrava um texto de contador ("6d 01h 13m") — bem menos visível que a caixa de dígitos grandes
que a Copa usa. Adicionada `countdownTimerHtml()`, mesmo algoritmo e mesma marcação
(`.count-grid` + dias/horas/min/seg em caixas, variante de 4 colunas quando há dias) do contador
da Copa (`renderNextMatch()` em `bolao/js/app.js`), substituindo o texto inline pela caixa —
`renderNextGameCard()` já tinha um `setInterval` de 1s próprio, então o contador novo já
atualiza ao vivo sem mudança adicional nesse ponto.

Mesmo achado, mesma correção aplicada ao CDB2026 — ver changelog do CDB2026 v3.11 (lá o gap era
maior: não só faltava a caixa, o card também não tinha nenhum tick de 1s próprio).

12 testes automatizados novos (caixa de dígitos presente, contador atualizando ao vivo com o
schedule da ESPN mockado). `node --check`: OK. `audit_scoring.py`: 5/5, sem impacto.

## v1.29 — 2026-07-14

### Fixed — palpites apagados ao interagir com o formulário (bug crítico, mesmo achado no CDB2026)

Mesmo bug e causa raiz do CDB2026 v3.9 (ver esse changelog para a investigação completa):
`renderAll()` reconstrói `#pickForm` (14 `<select>` de time) toda vez que roda, inclusive quando
um resync em segundo plano dispara sozinho (Supabase, a cada 30s ou em todo `focus`/
`visibilitychange` — abrir qualquer um dos `<select>` pode causar esse ciclo em vários
navegadores/mobile). Uma entrada nova, ainda não salva, não tinha proteção nenhuma contra isso.
Corrigido: `renderAll()` não reconstrói mais o formulário enquanto tiver algum time já
selecionado e ainda não salvo (`pickFormIsDirty()`). Confirmado com Playwright: um `focus`
disparado no meio do preenchimento apagava a seleção ~1s depois; corrigido, sobrevive até salvar.

### Fixed — inconsistências visuais com a Copa (auditoria "estilo big 4")

Eduardo pediu uma auditoria profunda comparando cores/fontes/tamanhos/posicionamento nos 3 apps.
Token a token nos 3 arquivos CSS:
- `--red`: era `#f87171` aqui e no CDB2026, a Copa usa `#ff6b6b` para o mesmo tom semântico
  (badge "ao vivo", não pago) — alinhado à Copa.
- `.section-head`: tinha `margin-bottom: 16px` + um `h2 { font-size: 22px }` que a Copa não tem
  — títulos de seção renderizavam maiores que na Copa. Removida a divergência.
- `input, select`: faltava `appearance: none` no seletor genérico — todo `<select>` sem regra
  própria mostrava a seta nativa do navegador em vez do visual limpo da Copa.

Ver `docs/bolao/DESIGN_SYSTEM.md` para a auditoria completa.

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto.

## v1.28 — 2026-07-14

### Fixed — CSV/formula injection no export (segurança)

Mesma varredura/mesmo bug da Copa (ver `bolao/CHANGELOG.md` v4.130): `exportCsv()` só escapava
aspas duplas, não os caracteres que disparam interpretação como fórmula no Excel/Sheets
(`=+-@`/tab/CR) em campos de texto livre (`entryName`, `payerName`). Adicionado `csvEscape` (novo
const, mesmo padrão da Copa) e trocado no `.map()` de `exportCsv()`.

### Fixed — blocos `catch` vazios sem comentário

Três `catch {}`/`catch (e) {}` sem o comentário exigido pelo `CLAUDE.md`. Adicionado comentário
explicando a razão do silêncio em cada um (cache de sessionStorage corrompido, storage
indisponível, polling de versão) — sem mudança de comportamento.

Sem mudança de scoring/regras. `audit_scoring.py` (Copa): 5/5.

## v1.27 — 2026-07-14

### Fixed — ordem dos botões do header/nav divergindo da Copa

Eduardo apontou que a ordem dos botões não era a mesma nos três apps. Auditado contra a Copa
(referência visual canônica): dois desalinhamentos reais no `index.html`.

1. **Header**: Copa tem WhatsApp → idioma (PT-BR/ES-MX/EN-US) → seletor de bolão; este app tinha
   idioma → WhatsApp, trocados de posição. Corrigido para bater com a Copa.
2. **Nav**: Copa tem Palpites → Ranking → Participantes → Pagamento → Jogos → Probabilidades →
   Regras → Admin (Participantes/Pagamento ficam ocultos por CSS na Copa, mas a posição no DOM é
   essa). Este app tinha Participantes/Pagamento depois de Probabilidades em vez de logo após
   Ranking. Corrigido — a aba "Tabela" (sem equivalente na Copa) manteve sua posição relativa,
   logo antes de Jogos.

Apenas reordenação de markup (`index.html`) — nenhuma mudança de `app.js`/CSS necessária (nada
depende da ordem do DOM; a navegação usa seletores por `data-section`, não índice). Verificado
via Playwright: zero erros de JS, navegação funcionando normalmente nos três apps depois da
mudança.

### Fixed — ícone do Zelle quebrado (asset ausente)

Auditoria cosmética completa pedida por Eduardo (44 screenshots via Playwright, 3 apps × desktop
+ mobile × todas as seções) encontrou um bug real, não apenas estético: `assets/zelle.svg` nunca
existiu neste app (só na Copa), mas `PAY_ICON_SVG` em `js/app.js` já referenciava esse caminho —
ícone de imagem quebrado no card de pagamento Zelle. Corrigido copiando o SVG da Copa (mesmo
arquivo, sem alteração de conteúdo). Ver `docs/bolao/DESIGN_SYSTEM.md` "Auditoria cosmética
completa" para o restante dos achados (dois itens de layout aguardando decisão do Eduardo, não
implementados nesta rodada).

## v1.26 — 2026-07-13

### Fixed — resync forçado ao voltar de uma aba em segundo plano (bfcache)

Eduardo pediu para garantir que nada fique "em cache" e que tudo reflita o Supabase depois da
sincronização ser ligada. Investigado: o app **já** usa a regra de merge correta (`results`/dados
travados sempre vencem do lado remoto — `preferRemoteResults: true`, mesmo padrão que corrigiu o
bug histórico "resultado real sobrescrito por localStorage de teste" na Copa — ver
`docs/bolao/LESSONS_LEARNED.md` "Supabase — merge/sync"). Remover o `localStorage` inteiramente
não teria corrigido aquele bug (a causa era a regra de merge, não a existência do
`localStorage`) e tornaria o app 100% dependente do Supabase estar no ar — pior para
confiabilidade, e o app já é `local-first` por design.

O que realmente faltava (gap já catalogado em `CONSISTENCY_MATRIX.md` item 23, nunca corrigido
até agora): o listener de `pageshow`/`event.persisted` que a Copa já tem desde a v4.111 — sem
ele, o Safari/iOS pode restaurar uma aba do bfcache (voltar de segundo plano) sem disparar
`visibilitychange` de forma confiável, deixando a página presa no estado em memória do último
carregamento real em vez de rebuscar o Supabase. Adicionado (junto com um listener de `focus`,
que também faltava) — mesmo padrão da Copa, agora `debouncedReload()` cobre
visibilitychange + focus + pageshow, todos debatidos em 60ms para não disparar chamadas
sobrepostas.

Testado (Playwright): carregamento inicial busca o Supabase; simular `pageshow(persisted:true)`
dispara um resync novo; disparar `focus` e `pageshow` juntos gera só uma chamada (debounce
funcionando), não uma rajada.

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto.

## v1.25 — 2026-07-13

### Changed — Supabase habilitado (`database.enabled: true`)

Eduardo pediu para não deixar dados só em `localStorage`. `database.enabled` ligado
(`js/config.js`), mesmo projeto/tabela Supabase que a Copa já usa (`bolao_state`, linha própria
via `stateId: "br2026"`). `localFallback: true` mantido — a arquitetura local-first com espelho
remoto não foi removida, só passou a sincronizar de fato.

**Ação pendente do lado do Supabase (fora do alcance desta sessão):** as policies de RLS só
liberavam `id='main'` — SQL para estender aos três apps em
`docs/bolao/DATABASE_SETUP_SUPABASE.md` "Múltiplos apps na mesma tabela", precisa ser rodado uma
vez no painel do Supabase por Eduardo. Até lá, o app continua funcionando normalmente em modo
local (testado com a resposta do Supabase mockada como 403 — nenhum erro não tratado, nenhuma
perda de dado local).

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto (mudança de infraestrutura, não de
scoring).

## v1.24 — 2026-07-13

### Fixed — texto confuso na tabela de Regras (parênteses duplicados)

Reportado por Eduardo: linhas como "🥇 1º Lugar (no G4 (posição errada))" — parênteses aninhados
confusos. Causa: `renderRules()` (`bolao/br2026/js/app.js`) já envolve o valor de
`t("rulesInG4")`/`t("rulesInZ4")` em parênteses no template; as strings em `i18n.js` também
traziam seus próprios parênteses (`"no G4 (posição errada)"`), duplicando o nível de aninhamento.
Corrigido removendo os parênteses internos das strings (`"no G4, posição errada"` /
`"no Z4, posição errada"`) — nenhuma mudança de valor de pontos, só de texto. Copa e CDB2026 não
têm o conceito de G4/Z4 (bracket e mata-mata, respectivamente), então o mesmo bug não existe nos
outros dois apps — nada a propagar.

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto (só texto).

## v1.23 — 2026-07-13

### Added — classificação ao vivo do Brasileirão + movimento de ranking dos participantes

Pedido de Eduardo, com auditoria obrigatória prévia contra o recurso equivalente da Copa (ver
`docs/bolao/BR2026_LIVE_STANDINGS.md` para o detalhamento completo). Resumo:

- **Tabela do Brasileirão** ganhou uma coluna "Mov." e passa a reordenar por posição ao vivo
  durante uma janela de partidas em andamento, recalculando pontos/saldo com os placares atuais.
  Função pura nova: `calculateLiveStandings({ baselineStandings, liveMatches, completedMatches,
  tieBreakRules })`. Baseline congelada em `sessionStorage` no momento em que a contagem de
  partidas ao vivo passa de 0 para >0 (nunca a cada gol); descartada quando volta a 0. Sem
  baseline confiável, mostra "indisponível" em vez de inventar uma posição anterior.
- **Ranking dos participantes** ganhou setas de movimento (`▲`/`▼`/`•`/`–`) com a mesma lógica.
  Função pura nova: `calculateRankingMovement()`, usando o padrão stateless correto já
  comprovado na Copa (`liveMatchPointsTable()`) — **não** o outro padrão da Copa
  (`computeRankArrows()`, baseline = último render), decisão confirmada explicitamente por
  Eduardo. Reaproveita o mesmo comparador (`rankEntries()`) usado pelo ranking exibido, para que
  baseline e live nunca possam divergir do total realmente mostrado na tela.
- Correções de escopo confirmadas junto: casamento de partida por `ev.id` estável da ESPN (antes
  só por nome de time — string matching); uso do flag `postponed` (já existia, nunca era lido)
  para excluir jogos adiados/cancelados do cálculo ao vivo.
- Higiene de rede: todo `fetch()` do app passa a usar `AbortController` com timeout de 10s;
  `pollAll()` nunca sobrepõe (`_pollInFlight`), não roda com `document.hidden`, e o loop trocou
  de `setInterval` fixo para um `setTimeout` autorreagendado com backoff em falha; foco de aba
  dispara um poll imediato.
- Novas classes CSS `.movement`/`.movement-up/-down/-same/-unavailable` (deliberadamente
  separadas do `.rank-arrow` da Copa — ver design system). Colunas Pos/Mov/Time/Pts da tabela
  agora usam `position: sticky` para nunca saírem de vista em 320–414px; nome de time trunca com
  reticências.
- Setas nunca são só glifo — `<span class="visually-hidden">` com texto completo em todas
  (`"Subiu 3 posições, de 5º para 2º"`, etc.), respeitando `prefers-reduced-motion`.

Testes: 27 testes puros (`calculateLiveStandings`, `zoneForPosition`, `rankEntries`,
`calculateRankingMovement`) + 9 testes de integração ponta a ponta com ESPN mockada — todos
verdes. `node --check` limpo nos 12 arquivos JS dos 3 apps. `audit_scoring.py`: 5/5, Copa
intocada. Scoring do BR2026, CDB2026 e regras do Brasileirão **não foram alterados** — apenas
classificação ao vivo, movimento e consistência do ranking.

## v1.22 — 2026-07-13

### Fixed — escudo do time ainda "nas pontas" em vez de flanquear o centro + token `--gold` ausente

Dois achados reportados por Eduardo depois do fix v1.21 (que só tinha removido o escudo de
*dentro* das barras de probabilidade, mas não corrigiu os outros lugares onde nome+escudo
aparecem em texto corrido):

1. **Escudo nas pontas.** O padrão canônico da Copa (`bolao/js/app.js`, `renderNextMatch()`)
   é nome fora / escudo dentro, flanqueando o "×" central: `Time A 🏳 × 🏳 Time B`. Este app
   fazia o oposto em 6 lugares (`live-teams`, `today-game-teams` ×3 variantes,
   `next-game-teams`): escudo fora, nome dentro. Invertido para bater com a Copa.
2. **`--gold` não definido no `:root`.** `.game-status.postponed` usava `var(--gold)` sem o
   token existir neste app (só Copa e CDB2026 tinham `--gold`) — o texto do badge "adiado"
   ficava sem cor válida. Adicionado `--gold: #f59e0b` (mesmo valor de Copa/CDB2026).

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto de scoring (só CSS/markup).

## v1.21 — 2026-07-13

### Fixed — topbar quebrava horizontalmente no mobile + escudo do time nas barras de probabilidade

Reportado com screenshots: página cortada/deslocada horizontalmente no celular, e as barras de probabilidade (card "Próximo Jogo" e aba Jogos) mostrando o escudo do time junto com o nome, diferente do bolão da Copa.

Dois fixes:
1. **Topbar** — mesma causa raiz do bolão da Copa (`bolao/css/styles.css`): seletor de bolão competindo por espaço com marca+WhatsApp numa linha só, e `grid-template-columns` sem `minmax(0, 1fr)` não deixava os itens encolherem. Mesmo fix: seletor em linha própria, `minmax(0, 1fr)`, subtítulo da marca escondido no mobile. Bônus: `.pick-pts-hint` (texto de dica nos palpites G4/Z4) também estava com `white-space: nowrap`, forçando overflow em telas bem estreitas (320-360px) — removido.
2. **Escudo nas barras de probabilidade** — as três funções que montam as barras ("Próximo Jogo" de hoje, "Próximo Jogo" sem jogo hoje, e a lista da aba Jogos) injetavam `<img>` do escudo do time dentro do texto da barra. Removido — agora mostra só "Time NN%", igual ao bolão da Copa (`probBarsMarkup` em `bolao/js/app.js`), inclusive o mesmo limite de 12% pra esconder o nome em fatias muito estreitas. Escudo ao lado do nome do time no cabeçalho do card (fora da barra) continua igual — não é o mesmo lugar do bug.

QA: 9 larguras testadas (320-1440px), zero overflow horizontal. Rodei `python3 bolao/scripts/audit_scoring.py` (bolão da Copa) — sem impacto, mudança isolada ao Brasileirão.

---

## v1.20 — 2026-07-13

### Fixed — fechamento da tarefa "Copa como referência canônica"

- `.admin-toolbar` gap/margin alinhados com a Copa (`8px`/`14px`, era `6px`/`8px`).
- `.admin-row` (lista de entradas/pagamentos no admin) **mantido** como lista densa em vez de
  virar um card por linha como a Copa — decisão consciente registrada em
  `docs/bolao/CONSISTENCY_MATRIX.md` item 78 (densidade de dados + área admin-only de baixa
  visibilidade), não uma omissão.

Ver `docs/bolao/DESIGN_SYSTEM.md` para a tabela de mapeamento completa desta rodada e a
tabela de validação (com a ressalva de que não houve captura visual real — sem navegador
disponível neste sandbox, tudo verificado por leitura de CSS).

`audit_scoring.py`: 5/5 — só CSS.

## v1.19 — 2026-07-12

### Fixed — bugs reais reportados testando o site ao vivo

- **Tabela do Brasileirão sem V/E/D/GF/GC/SG**: `fetchStandings()` só extraía
  `points`/`gamesPlayed`/`gf`/`ga` da ESPN. Adicionado `wins`/`ties`(`draws`)/`losses`/
  `pointDifferential` (nomes de stat confirmados direto no endpoint real da ESPN) e as colunas
  correspondentes na tabela — padrão J/V/E/D/GP/GC/SG/Pts de tabela de futebol brasileiro.
- **Jogos não alinhavam**: `.game-matchup` era `flex` com `justify-content:center` — o placar/
  hora central não ficava na mesma posição horizontal entre linhas com nomes de time de
  tamanhos diferentes, porque flex empacota pelo conteúdo. Trocado para grid `1fr auto 1fr`
  (mesmo padrão de `.game-teams` na Copa), forçando as duas colunas de time a terem a mesma
  largura — o centro sempre alinha agora, independente do tamanho do nome.
- **Botão WhatsApp**: texto visível era só "WhatsApp"; Copa usa "Suporte WhatsApp". Alinhado.
- **Card de pagamento sem ícone**: `.pay-card` não tinha o ícone por método (CashApp/Zelle/
  Venmo) que a Copa tem — `cashapp.svg`/`venmo.svg` copiados para `assets/`, `payIcon()`
  portado, `zelle.qrImage` configurado (asset já existia). `.pay-grid`/`.pay-card` migrados
  para o mesmo layout/tokens da Copa (3 colunas fixas, ícone + texto em linha, `var(--bg2)`/
  `border-radius:16px`).
- **Spinner nativo removido** dos inputs numéricos (mesmo fix nos três apps).

`audit_scoring.py`: 5/5 — só CSS/apresentação, nenhum dado de standings usado para
scoring/ranking (BR2026 não pontua pela tabela do Brasileirão em si, só pelos palpites de
G4/Z4/SA6 dos participantes).

## v1.18 — 2026-07-12 (WIP — commit parcial)

### Fixed — Copa como referência visual canônica (início; tarefa incompleta)

Início da padronização com a Copa (`bolao/`) como referência visual canônica (nova regra
permanente em `CLAUDE.md`). Commit parcial por limitação de créditos da sessão — ver
`docs/bolao/CONSISTENCY_MATRIX.md`/`DESIGN_SYSTEM.md` para o que ainda falta (auditoria
completa de jogos/times, admin, pagamento, regras, e a tabela de validação visual por
viewport pedidas na tarefa não foram concluídas).

- **`main` max-width**: `860px` → `1140px`, igual à Copa.
- **`.game-card`**: era uma linha de lista plana (só `border-bottom`); agora usa o mesmo
  tratamento de card da Copa (`background`, `border`, `border-radius:16px`, `margin-bottom`).

`audit_scoring.py`: 5/5 — só CSS.

## v1.17 — 2026-07-12

### Added — sistema de toast + badge/status unificado + ranking reestruturado (findings Critical/High autorizados)

Autorização explícita do Eduardo para implementar os 3 findings maiores do
`docs/bolao/DESIGN_SYSTEM.md` que ficaram pendentes na rodada anterior (patch mínimo só CSS).
Ver `docs/bolao/CONSISTENCY_MATRIX.md` itens 67-69 e `bolao/CHANGELOG.md` v4.127.

- **Badge/status unificado**: `.game-status` deixou de ser só texto colorido e virou pílula
  (`border-radius:999px; padding:4px 10px`), mesmo tratamento do `.status-chip` da Copa —
  adicionado `.game-status.live` com a mesma animação de pulso (`@keyframes live-pulse`,
  copiado da Copa, não existia aqui). `.paid-badge`/`.unpaid-badge` ganharam
  `border-radius:999px`/`padding:4px 10px`/`font-weight:900` (eram `6px`/`3px 8px`/`700`).
- **Sistema de toast portado da Copa**: `showToast()` (mesma implementação, copiada de
  `bolao/js/app.js`) + CSS `.bolao-toasts`/`.bolao-toast` (4 variantes: success/error/warn/
  info). Convertidos os `alert()`s de confirmação/erro que não são validação de formulário
  (fluxo de salvar entrada, admin login/lockout, sync, resultados) — validação de campo
  obrigatório continua `alert()`, de propósito, igual à Copa.
- **Ranking reestruturado**: `.rank-card` empilhado (com o detalhe de palpites sempre visível)
  substituído pelo `.rank-row` denso de 1 linha da Copa + `.picks-detail` expansível por clique
  (`data-rank-toggle`/`_openRankDetails`, mesmo padrão de `bolao/js/app.js`). Card de posição/
  nome/pontos/badge de pagamento/botão "Ver palpites" numa linha só; detalhe dos palpites some
  por padrão, mesmo comportamento em mobile (breakpoint 900px com coluna de pontos de largura
  fixa, já usado na Copa desde as rodadas de otimização documentadas em `LESSONS_LEARNED.md`).
- Nova chave i18n: `viewPicks`.

`audit_scoring.py`: 5/5 — mudança é de apresentação/interação, nenhuma fórmula de pontuação ou
critério de desempate foi tocado (o `scored.sort()` que já existia continua idêntico).

## v1.16 — 2026-07-12

### Fixed — patches mínimos de design system (auditoria de UX cross-app)

Parte dos findings de baixo risco do `docs/bolao/DESIGN_SYSTEM.md`, CSS-only:

- **`h1,h2,h3` normalizado globalmente** — antes só existia `.section-head h2`; um `<h3>` fora
  dessa seção (ex.: dentro de um `.card`) caía no tamanho/margem default do navegador,
  diferente da Copa. Mesma regra da Copa portada (`margin:.15em 0 .4em`, `h2:1.25rem`,
  `h3:1.05rem` — sem `h1` explícito, a Copa também não tem).
- **Botão sticky (`.sticky-submit button`)**: sombra `rgba(0,0,0,.5)` → `rgba(47,229,110,.35)`
  (verde, igual à Copa) — `min-width:200px` já existia.
- Input/select/label e `.rules-table` padding já batiam com a Copa antes desta rodada — nenhuma
  mudança necessária aqui (a Copa que migrou para o padrão que este app já tinha).

Findings maiores (badge/status, ranking, toast) não implementados nesta rodada — ver
`bolao/CHANGELOG.md` v4.126 para o racional completo.

`audit_scoring.py`: 5/5 (só CSS).

## v1.15 — 2026-07-12

### Fixed — escudo do time renderizando em tamanho gigante (bug real do fix de v1.14)

Reportado por Eduardo testando o site ao vivo: o fix de v1.14 (escudo no card "Ao vivo"/
"Próximo jogo") usava `teamLogoImg()` gerando `<img class="team-logo">` sem `width`/`height` —
e a classe `.team-logo` no CSS também não tinha essas dimensões definidas (os usos antigos, nas
barras de probabilidade, tinham `width="14" height="14"` como atributo HTML inline direto,
mascarando a lacuna). Resultado: o navegador renderizava a imagem no tamanho nativo do arquivo
da ESPN (bem maior que 14px) nos dois cards novos. Corrigido adicionando `width:14px;
height:14px` diretamente à classe `.team-logo` no CSS — cobre todos os usos, novos e antigos,
sem depender de atributo inline em cada `<img>`.

`audit_scoring.py`: 5/5 (só CSS).

## v1.14 — 2026-07-12

### Fixed — escudo do time só aparecia na barra de probabilidade, não no card do jogo

Reportado por Eduardo: o escudo do time (`_teamLogos`, vindo do standings da ESPN) já era
buscado e usado dentro das barrinhas de probabilidade, mas os dois widgets mais visíveis da
tela — o card "Ao vivo" (`renderLiveCard`) e o card "Hoje tem jogo"/"Próximo jogo"
(`renderNextGameCard`, nos 3 estados: ao vivo, encerrado hoje, e sem jogo hoje) — mostravam só
o nome do time em texto puro, sem nenhum símbolo. A aba Jogos (`renderGamesSection`) já
mostrava o escudo corretamente ao lado do nome — só os widgets do topo da página estavam sem.

- Extraído helper `teamLogoImg(team, cls)` reaproveitando `_teamLogos` (já existente).
- Escudo adicionado nas bordas externas dos nomes de time (mesmo padrão visual da Copa com
  bandeira) em `renderLiveCard`, `renderNextGameCard` (todos os 3 estados) e
  `renderNextGameCard`'s "próximo jogo" (sem jogo hoje).
- Só CSS/markup — nenhuma lógica de scoring, ranking ou dado alterada. `audit_scoring.py`: 5/5.

### Added — botão WhatsApp no topbar

Resolve a divergência `MISSING` catalogada em `docs/bolao/CONSISTENCY_MATRIX.md` item 34 —
reaproveita o mesmo grupo, QR e ícone da Copa do Mundo (`assets/whatsapp.svg`,
`assets/whatsapp-group-qr.png`), não é um grupo novo.

## v1.13 — 2026-07-12

### Fixed — CSS badge para jogos adiados

- `.game-status.postponed { color: var(--gold); }` adicionado (texto "Adiado" em dourado)
- Completa implementação de detecção de jogos adiados via ESPN (`status.type.name === "Postponed" || "Canceled"`)
- `audit_scoring.py`: 5/5.

---

## v1.12 — 2026-07-12

### Novo — botões de idioma no topbar (padronização com Copa)

- Adicionado `lang-links` ao topbar: PT-BR ativo, ES-MX e EN-US desabilitados
- Desktop: grid `1fr auto auto` → brand | lang | switcher
- Mobile: brand | switcher (row 1) → lang (row 2) → nav (row 3)
- `audit_scoring.py`: 5/5.

---

## v1.11 — 2026-07-12

### Fixed — alinhamento topbar + cutoff atualizado

- `align-items: center` no grid do topbar (desktop e mobile)
- `cutoffIso` atualizado para **domingo 19/jul às 23h59 BRT** (2 dias antes do reinício do Brasileirão)
- `audit_scoring.py`: 5/5.

---

## v1.10 — 2026-07-12

### Fixed — segurança + CSS (Big Tech QA audit)

- **SEC LOW-1**: whitelist antes de `location.href` no switcher de bolão
- **CSS MOB-3**: `-webkit-backdrop-filter` adicionado (blur do topbar no iOS Safari ≤ 15)
- `audit_scoring.py`: 5/5.

---

## v1.9 — 2026-07-12

### Design — padronização 100% com a Copa do Mundo (auditoria sistemática)

11 diferenças identificadas por auditoria diff completa dos 3 CSS/HTML. Todas corrigidas:

- **Nav**: convertido de `flex-wrap` para `grid repeat(9, 1fr)` — botões sempre com largura uniforme, idêntico à Copa
- **Topbar responsivo**: adicionados breakpoints `@media ≥901px` e `≤900px` — topbar vira grade de 2 linhas (brand+switcher em cima, nav em baixo) igual à Copa
- **Card**: `border-radius 16px → 18px`, `padding 18px 20px → 18px`, `margin-bottom 16px → 14px`, adicionado `box-shadow 0 8px 32px rgba(0,0,0,.22)`
- **Countdown**: `.count-card` ganhou `background var(--bg3)`, `border`, `border-radius 16px`, `padding 16px`; `.count-grid` virou `grid repeat(4, 1fr)`; células `background var(--bg)`, `border-radius 12px`; números agora em `color: var(--green)`, `font-size 26px`
- **Brand gap**: `6px → 8px`
- **Footer**: `margin-top 32px`, `opacity .6`, `border-top var(--border2)`, `user-select none`, links com hover
- **Focus ring**: adicionado `button/input/select:focus-visible` (acessibilidade)
- **Mobile `≤500px`**: `count-grid` vira 2 colunas no celular

`audit_scoring.py`: 5/5.

---

## v1.8 — 2026-07-11

### Fixed
- **Auto-sync não apaga mais o formulário**: setInterval de 30s agora verifica `document.hidden || _editingEntry` antes de chamar `renderAll()` — usuário preenchendo palpites não perde os dados no meio
- **Email throttle**: `br2026_emailTs` agora só é gravado no sessionStorage *após* o `await emailjs.send()` ter sucesso (com try/catch). Antes, falha de rede consumia o throttle silenciosamente.
- **Flash de seção errada**: `<section id="entry">` não tem mais `class="active"` no HTML — o Ranking abre instantaneamente (prazo já encerrado) sem flash do form de palpites
- **iOS Safari — switcher**: `appearance: none; -webkit-appearance: none` adicionados — pill estilizado funciona no iPhone agora

## v1.7 — 2026-07-11

### Changed
- **Jogos — layout centralizado**: card de partida agora exibe `Nome | Bandeira | Score | Bandeira | Nome` em fileira única centrada — nada para a esquerda ou direita. Linha `.game-meta` (status/partida/venue) também centralizada

## v1.6 — 2026-07-11

### Added
- **Dropdown bolão-switcher**: header agora tem `<select>` para navegar entre Copa do Mundo, Brasileirão 2026 e Copa do Brasil 2026 sem voltar para a página principal

### Changed
- **Jogos — novo layout de partidas**: cards de jogo agora usam CSS Grid `1fr auto 1fr` com logos ESPN em cada lado — times nunca quebram linha no mobile ou no desktop. Nomes longos ficam truncados com reticências. Venue/status/número da partida consolidados numa única linha `.game-meta` abaixo do placar
- **Ranking — tiebreaker Z→A**: quando tudo mais empata, a ordenação de exibição agora é Z→A (igual à Copa v4.105) em vez de A→Z — sem mudança de posição/medalha
- **Seção padrão = Ranking**: `init()` abre direto no Ranking quando o prazo já passou (`isPastCutoff()`), em vez de sempre abrir Palpites
- **document.hidden guard**: ticker de 1s (`renderLiveCard` / `renderNextGameCard`) agora pula quando a aba está em background — elimina setInterval desnecessário
- **mergeStates `preferRemoteResults`**: `loadRemoteState()` agora passa `{ preferRemoteResults: true }` para que resultados do Supabase sempre sobrescrevam o cache local ao sincronizar (equivalente ao Copa v4.108)
- **Auto-sync 30s**: quando `database.enabled: true`, sincroniza com Supabase a cada 30s automaticamente

## v1.5 — 2026-07-02

### Added / Changed
- **Dixon-Coles IPF**: estimação de ataque/defesa por Iterative Proportional Fitting (50 iterações, decaimento exponencial de 10 jogos) — substitui médias simples de gols
- **Dixon-Coles ρ correction** (ρ=−0.13): ajuste de probabilidades em placar 0-0/1-0/0-1/1-1 aplicado ao `matchProb`
- **expectedGoals dual-mode**: modo IPF quando há dados suficientes; fallback com LG_AVG no início de temporada
- **Hero card — barras de prob pré-jogo**: jogos agendados do dia e card do próximo jogo mostram barras visuais de probabilidade com logos
- **Jogos — "Partida N"**: número sequencial em cada card de jogo; logo agora aparece após o nome do time

## v1.4 — 2026-07-02

### Added
- **Logos ESPN nos jogos**: escudos dos clubes carregados da API ESPN (CSP atualizada para `https://a.espncdn.com`)
- **Jogos de hoje**: card do próximo jogo substituído por lista de todos os jogos do dia atual — jogos ao vivo destacados, encerrados em cinza, próximos com countdown
- **Auto-scroll Jogos**: ao clicar na aba Jogos, a lista rola até o próximo jogo agendado
- **Título corrigido**: browser tab agora mostra "Bolão do Ferrari — Brasileirão 2026"

### Changed
- **Barras de probabilidade pré-jogo**: Jogos agendados mostram barras visuais coloridas com nome dos times (substituiu texto "Casa X% · Emp Y% · Fora Z%")
- **Nav buttons**: estilo igual ao da Copa (fundo sólido, verde no ativo)
- **Botão Recalcular**: aparece mesmo durante "Calculando..." para permitir retry
- **Monte Carlo GD corrigido**: GD agora determinado pelos gols amostrados `hg/ag` (não por comparação independente com `pH`) — resultados estatisticamente coerentes
- **buildRatings cacheado**: recalculado só quando standings atualizam, não a cada segundo

### Fixed
- **Monte Carlo fim de temporada**: quando não há jogos restantes, retorna classificação final determinística (100%/0%) em vez de estado "Calculando..." permanente
- **prob-bar-mini px→%**: barras na tabela de probabilidades agora escalam corretamente (era `width:${n}px`, correto é `width:${n}%`)
- **buildRatings floor**: ataque/defesa mínimo de 0.3× para evitar P(Emp)=100% em times com `gf=0`
- **matchProb normalizado**: probabilidades somam exatamente 100%
- **ARIA**: `scope="col"` nos th, `aria-hidden="true"` nas barras decorativas, `role="group"` nas prob-bars
- **scheduleMC debounce**: `_mcTs` atualizado antes do setTimeout para evitar enfileiramento duplo

## v1.3 — 2026-07-02

### New features
- **Probabilidades tab**: new nav section with Poisson + Monte Carlo (2 000 simulations) championship probability table — P(G4) / P(Sul-Am.) / P(Rebaixado) per team, sorted by G4 probability, with color-coded mini bars and a Recalcular button
- **In-play probability bars**: when a match is live the card now shows animated win/draw/loss probability bars computed from in-play Poisson adjusted for time remaining and current scoreline
- **Per-match probability hints**: upcoming (pre) games in the Jogos section now show "Casa X% · Emp Y% · Fora Z%" hint lines derived from the same Poisson model
- **Poisson model**: `buildRatings()` / `expectedGoals()` / `matchProb()` / `inPlayProb()` / `runMonteCarlo()` — all pure vanilla JS, no external libraries
- **fetchStandings() extended**: now also parses `gamesPlayed`, `pointsFor`, `pointsAgainst` from ESPN stats array (needed for attack/defence ratings)
- **Match prob cache**: `_matchProbs` object caches per-fixture win/draw/loss probs; cleared on each standings poll so ratings stay fresh

## v1.2 — 2026-07-02

### Bug fixes (post mega-audit)
- **fix(timezone)**: remove `toBRT()` manual UTC-3 offset arithmetic; replace with `{ timeZone: "America/Sao_Paulo" }` in all `toLocale*` calls — was showing wrong times for users outside Brazil
- **fix(tiebreaker)**: `renderRanking()` now uses officially locked G4/Z4 results for tiebreakers when `results.locked === true`, instead of live ESPN standings that may differ
- **fix(live-overlay)**: `pollAll()` now updates ALL scoreboard matches (including post-game) in `_schedule` cache, preventing finished games from staying "Ao vivo" until TTL expires
- **fix(admin-validation)**: `saveResultsBtn` now validates SA6 ↔ G4 and SA6 ↔ Z4 overlap, preventing double-scoring for a team appearing in two zones
- **fix(emailjs-throttle)**: `sendReceipt()` now honours `C.emailjs.limitRateMs` (30s) via sessionStorage — the config value was defined but never enforced
- **fix(cache-key)**: schedule sessionStorage key is now versioned (`br2026_schedule_v1.2`) to prevent stale schema reads after version bumps
- **fix(a11y)**: removed `aria-live="polite"` from countdown div — was causing screen readers to announce every second tick

## v1.1 — 2026-07-02

### New features
- **Sul-Americana picks**: 6 team dropdowns (positions 7–12), 8 pts per correct pick — mutual exclusion with G4/Z4
- **Jogos calendar**: full 382-game Brasileirão schedule from ESPN, grouped by BRT date with venue/city; live games overlay real-time scores
- **Next game card**: countdown to next scheduled game with venue; shows live score if a match is in progress
- **Tiebreakers**: SA6 hits → G4 exact positions → Z4 exact positions
- **Standings SA zone**: rows 7–12 highlighted in amber with SA badge
- **Language**: removed es and en-US — BR2026 is pt-BR only
- **Admin results**: 3-column grid (G4 / Sul-Am. / Z4), ESPN auto-fill covers all zones
- **Rules**: updated scoring table (max 176 pts) with tiebreaker list

## v1.0 — 2026-07-02

### Initial release
- G4 (top 4, in order) + Z4 (bottom 4, in order) picks
- 8 dropdowns with mutual-exclusion validation (no team can appear twice or in both G4/Z4)
- Provisional scoring from live ESPN standings throughout the season
- Standings card with ESPN Brasileirão (bra.1) live table — polls every 60s
- Live match card when a Brasileirão match is in progress
- Admin: lock official result at season end, or fill from current ESPN standings
- Admin: payment tracking, entry edit/delete, CSV export
- Email receipt on save (EmailJS, same templates as Copa bolão)
- 3-language support: pt-BR, es, en-US
- Supabase integration ready (set `database.enabled: true` after creating row `id='br2026'`)
- Not published yet (no link from main site)
