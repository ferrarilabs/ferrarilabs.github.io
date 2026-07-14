# Bolão Copa do Brasil 2026 — CHANGELOG

## v3.9 — 2026-07-14

### Fixed — palpites apagados ao interagir com o formulário (bug crítico)

Eduardo reportou: "quando estou entrando os palpites e clico no time que passa ele apaga tudo
que entrei". Reproduzido com Playwright: `renderAll()` reconstrói `#pickForm` inteiro toda vez
que roda — inclusive quando dispara sozinho de um resync em segundo plano (Supabase, a cada 30s
ou em todo `focus`/`visibilitychange`). Abrir o `<select>` "quem se classifica" causa um ciclo de
blur/focus da janela em vários navegadores/mobile (o seletor nativo tira e devolve o foco), o que
dispara esse resync no meio da digitação. A proteção existente (`_editingEntry`) só cobre quando
o participante carregou uma entrada JÁ salva para editar — uma entrada nova, nunca salva, fica
sem proteção nenhuma o tempo todo em que está sendo preenchida.

Corrigido: `renderAll()` não reconstrói mais o formulário de palpites enquanto ele tiver algo
digitado e ainda não salvo (`pickFormIsDirty()`), não importa o motivo do `renderAll()` ter
rodado. **Mesmo bug e mesma correção aplicados ao BR2026** (mesmo padrão de código) — ver
changelog do BR2026 v1.29. A Copa não tem esse bug: lá, construir o formulário
(`renderBracket()`) e atualizar o estado visual a partir dos valores já digitados
(`updateDynamic()`, chamada em todo `renderAll()`) já são funções separadas desde o início —
um resync nunca reconstrói os `<input>` que já existem na tela.

Confirmado com Playwright: disparar um evento de `focus` no meio do preenchimento apagava o
placar digitado ~1s depois (quando o fetch em segundo plano terminava); com a correção, o valor
sobrevive indefinidamente até o participante salvar.

### Fixed — "Buscar minha entrada" travado para sempre (regressão da v3.8)

A v3.8 (fase-1 sem confronto nenhum, de propósito) quebrou `fase1Complete()`: a função só
retornava `true` se a fase tivesse confronto cadastrado E todos resolvidos — como fase-1 nunca
tem confronto nenhum, isso nunca seria `true`, e o card "Buscar minha entrada" (usado para editar
uma entrada já salva) ficava escondido/travado permanentemente, mesmo a fase já tendo acabado de
verdade. Corrigido: `fase1Complete()` também retorna `true` quando a fase está em
`DATA.phasesConcludedNoData` (que é exatamente o caso da fase-1 desde a v3.8).

### Added — card "Próxima partida"

Achado durante a auditoria visual pedida por Eduardo ("próximo jogo mostra dia hora estádio mas
não está consistente nos 3"): CDB2026 era o único dos três apps sem nenhum card de "próximo
jogo" — não existia CSS, HTML nem função de render para isso. Adicionado `#nextTieCard`, mesmas
classes CSS do BR2026 (`.next-game-*`) e mesmo formato de data (`fmtDate()`, idêntico ao
`brtLongDate()` do BR2026) — mesma aparência exata nos dois apps. Também corrigido em conjunto:
a Copa não mostrava a data (só hora) no card "Próximo jogo" — agora mostra data + hora nos três
apps.

Depende de `matches[leg].kickoff` estar preenchido — hoje isso só acontece via sincronização com
a ESPN, que foi estendida para gravar `kickoff`/`venue`/`city` na primeira perna de um confronto
novo (antes só gravava placar de partida já finalizada). Ainda não existe um jeito do admin
cadastrar `kickoff` manualmente para um confronto — o card fica escondido normalmente até isso
acontecer, mesmo comportamento de "sem próximo jogo" que a Copa/BR2026 já têm quando não há dado.
Registrado como lacuna conhecida, não corrigida nesta rodada (ver PROJECT_MEMORY.md).

### Fixed — inconsistências visuais entre os três apps

Auditoria "estilo big 4" pedida por Eduardo, token a token nos 3 arquivos CSS:
- `--red`: CDB2026/BR2026 usavam `#f87171`, a Copa usa `#ff6b6b` para o mesmo tom semântico
  (badge "ao vivo", não pago, etc.) — alinhado à Copa (referência canônica).
- `.section-head`: CDB2026/BR2026 tinham `margin-bottom: 16px` + um `h2 { font-size: 22px }`
  que a Copa não tem (usa o `h2` genérico, 20px/1.25rem) — títulos de seção renderizavam
  visivelmente maiores nos dois apps. Removida a divergência.
- `input, select`: faltava `appearance: none` no seletor genérico (a Copa já tinha) — todo
  `<select>` sem essa regra própria (ex.: método de pagamento, palpite de time) mostrava a seta
  nativa do navegador em vez do visual limpo já usado em `.bolao-switcher select`/`.lang-links`.

Ver `docs/bolao/DESIGN_SYSTEM.md` para a auditoria completa (o que foi corrigido e o que ficou
documentado como `TOURNAMENT_SPECIFIC`/`INTENTIONALLY_DIFFERENT`).

19 testes automatizados novos cobrindo os itens acima, todos passando. `node --check`: OK.
`audit_scoring.py`: 5/5, sem impacto em pontuação.

## v3.8 — 2026-07-14

### Added — população da 5ª Fase (histórico, referência) + fases passadas fora dos palpites

Eduardo pediu para popular "os jogos anteriores" (só para referência) e tirar do formulário de
palpites as fases já decididas. O torneio tem 5 fases antes das Oitavas (126 times, 90+ partidas
nas 4 primeiras) — todas já concluídas antes deste bolão existir.

Escopo decidido por Eduardo depois de eu apresentar o trade-off risco/esforço: só a 5ª Fase (32
times, 16 confrontos, fontes de imprensa boas) foi populada em detalhe — `DATA.knownConfrontos["fase-5"]`
em `data.js`, com o placar real de ida e volta dos 16 confrontos. 1ª a 4ª fase (90+ partidas de
times estaduais/regionais menores, fontes bem mais esparsas) ficam marcadas como já concluídas
sem placar partida a partida (`DATA.phasesConcludedNoData`).

`seedKnownConfrontos()` generalizada para aceitar confronto já decidido (`winner` + `legs`), não
só confronto futuro (só `teamA`/`teamB`, como a Oitavas). Validação cruzada forte: os 16
vencedores da 5ª fase batem exatamente com os 16 times já cadastrados na Oitavas (v3.6) — nenhum
de menos, nenhum a mais, nenhum duplicado.

`renderPickForm()` agora pula qualquer fase 100% decidida ou sem dado — cobre 5ª fase e 1ª–4ª. A
aba "Jogos" mostra os cards reais da 5ª fase e uma nota de "já concluída" (em vez de "aguardando
sorteio", que seria enganoso) nas fases sem dado.

Sourcing e limitações documentados em `docs/bolao/CDB2026_RULES_AND_MODEL.md` seção 7.2 — mesmo
padrão de transparência da v3.6 (2+ fontes por confronto, dois erros de busca pegos e corrigidos
antes de entrar no código, sem verificação contra API oficial da CBF/ESPN neste ambiente).

19 testes novos (`test_fase5_seed.js`), todos passando. Sem mudança de scoring — fase nunca
esteve aberta a palpite. `audit_scoring.py` (Copa): 5/5.

## v3.7 — 2026-07-14

### Fixed — CSV/formula injection no export (segurança)

Mesma varredura/mesmo bug da Copa e do Brasileirão (ver changelogs respectivos). `exportCsv()`
só escapava aspas duplas, não os caracteres que disparam interpretação como fórmula no
Excel/Sheets (`=+-@`/tab/CR) em campos de texto livre (`entryName`, `payerName`). Adicionado
`csvEscape` (novo const, mesmo padrão dos outros dois apps) e trocado no `.map()` de
`exportCsv()`.

### Fixed — bloco `catch` vazio sem comentário

Um `catch (e) {}` (polling de versão) sem o comentário exigido pelo `CLAUDE.md`. Adicionado —
sem mudança de comportamento.

Sem mudança de scoring/regras. `audit_scoring.py` (Copa): 5/5.

## v3.6 — 2026-07-14

### Added — população inicial das Oitavas de Final já sorteadas

Eduardo pediu, pela terceira vez, para popular os confrontos já conhecidos — a ferramenta de
sincronização com a ESPN (v3.1/v3.3) por si só não resolvia porque depende do admin acessar o
painel e escolher a fase, e o ambiente de desenvolvimento não tem acesso de rede a
`site.api.espn.com`/`supabase.co` para verificar ou popular remotamente. Mudança de curso:
semear os 8 confrontos das Oitavas de Final diretamente, já que são fato conhecido (sorteio da
CBF em 26/05/2026), não invenção de chaveamento futuro.

- `DATA.knownConfrontos.oitavas` (novo, `js/data.js`): os 8 confrontos com mando de campo por
  perna (`teamA` manda a ida, `teamB` manda a volta/decisiva) — Vasco×Fluminense,
  Internacional×Corinthians, Mirassol×Grêmio, Athletico-PR×Vitória, Atlético-MG×Juventude,
  Santos×Remo, Chapecoense×Cruzeiro, Palmeiras×Fortaleza.
- `seedKnownConfrontos()` (novo, `js/app.js`): roda uma única vez por estado
  (`s.espnSync.seededKnownConfrontos`), depois do merge com o Supabase (nunca antes — não
  semeia por cima do que outro dispositivo já salvou). Depois da primeira vez, nunca reaplica —
  se o admin remover um confronto errado pela UI existente, ele não volta sozinho. Nenhum
  placar ou classificado é fabricado — só o par de times; datas de kickoff ficam em aberto
  ("Data a definir") até a CBF publicar a tabela detalhada e o admin preencher.
- `espnSync.activePhaseId` também é definido para `"oitavas"` como padrão, então a sincronização
  automática com a ESPN (v3.3) já fica ativa para pegar resultados/atualizações a partir de
  agora, sem passo manual adicional.

**Fonte e limitação de confiança, registradas com transparência**: dados de busca pública
(múltiplas matérias jornalísticas, incluindo o site oficial do Corinthians), cruzados entre 3+
fontes independentes para cada par — mas **não verificados contra uma chamada direta à API da
CBF/ESPN** (sem acesso de rede externo neste ambiente). Uma busca inicial trouxe um resultado
contraditório (Corinthians×Palmeiras, de uma notícia de outro ano misturada no resultado) —
descartado depois de uma busca mais específica confirmar Corinthians×Internacional em 5+ fontes,
incluindo `corinthians.com.br`. **Confira contra a tabela oficial da CBF antes do prazo de
palpites** — qualquer confronto errado pode ser removido e recriado corretamente pela tela
"Fases e confrontos" do admin, sem risco a resultados já lançados (nenhum existe ainda).

18 testes automatizados (Playwright): semeia exatamente 8 confrontos na primeira carga; todos os
8 pares corretos com mando de campo correto; nenhum placar/classificado fabricado; ids
determinísticos; reload não duplica; admin consegue remover um confronto semeado e ele não volta.

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto — nenhuma fórmula de pontuação alterada,
só a origem dos dados de confronto (população inicial em vez de cadastro manual).

## v3.5 — 2026-07-14

### Fixed — ordem dos botões do header/nav divergindo da Copa

Mesma correção aplicada ao BR2026 nesta versão — ver o CHANGELOG do BR2026 v1.27 para a
explicação completa. Resumo: header reordenado para WhatsApp → idioma → seletor de bolão (batia
com a Copa antes trocado); nav reordenado para Palpites → Ranking → Participantes → Pagamento →
Jogos → Probabilidades → Regras → Admin, igual à posição no DOM da Copa (Participantes/Pagamento
estavam depois de Probabilidades). Apenas `index.html`, sem mudança de `app.js`/CSS.

### Fixed — ícone do Zelle quebrado (asset ausente)

Mesmo bug do BR2026 nesta versão — ver o CHANGELOG do BR2026 v1.27. `assets/zelle.svg` nunca
existiu neste app; `PAY_ICON_SVG` em `js/app.js` já referenciava esse caminho, resultando em
ícone quebrado no card de pagamento Zelle. Corrigido copiando o SVG da Copa. Encontrado durante
auditoria cosmética completa (44 screenshots via Playwright) pedida por Eduardo — ver
`docs/bolao/DESIGN_SYSTEM.md` "Auditoria cosmética completa" para os demais achados (dois itens
de layout aguardando decisão, não implementados nesta rodada).

## v3.4 — 2026-07-13

### Fixed — resync forçado ao voltar de uma aba em segundo plano (bfcache)

Mesma correção aplicada ao BR2026 nesta versão — ver o CHANGELOG do BR2026 v1.26 para a
explicação completa (bug histórico, por que remover `localStorage` não seria a correção certa,
o que realmente faltava). Resumo: adicionado `debouncedReload()` cobrindo
visibilitychange + focus + `pageshow`/`event.persisted` (gap catalogado em
`CONSISTENCY_MATRIX.md` item 23), mesmo padrão que a Copa já tem desde a v4.111. A regra de
merge (`preferRemoteResults: true`) já estava correta neste app — o gap era só a confiabilidade
do gatilho de resync, não a lógica de merge.

Testado (Playwright): mesmos 4 casos do BR2026, todos passando.

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto.

## v3.3 — 2026-07-13

### Changed — sincronização com ESPN totalmente automática

Eduardo testou a v3.1 (clicar "Buscar", escolher fase, clicar "Adicionar" por confronto) e achou
o fluxo ruim. Removido o clique por confronto:

- Novo campo de estado `s.espnSync.activePhaseId` — a única decisão que continua manual: qual
  fase é "a atual" agora. Não dá para inferir isso com segurança a partir dos dados da ESPN sem
  verificação ao vivo (ver `docs/bolao/CDB2026_RULES_AND_MODEL.md`).
- Com a fase ativa escolhida, a sincronização roda sozinha: ao abrir o painel admin, a cada 5
  minutos se ele continuar aberto, e via um botão "🔄 Sincronizar agora" para forçar na hora.
  Confrontos novos (par de times ainda não cadastrado em nenhuma fase) são criados
  automaticamente — sem clique.
- **O que continua manual, de propósito:** travar um resultado. Isso decide o pagamento — a
  sincronização só preenche o placar de uma partida única já finalizada na ESPN (mesmo dado,
  sem precisar redigitar), mas quem confirma e trava o resultado continua sendo o fluxo já
  existente em "Resultados".
- IDs de confronto adicionados pela sincronização passaram a ser determinísticos
  (`espn-<time-a>_<time-b>`, normalizado e ordenado) em vez de aleatórios — se dois dispositivos
  rodarem a sincronização automática de forma independente antes de se encontrarem no Supabase,
  os dois geram o mesmo id para o mesmo confronto real, e o merge (por chave) colapsa em uma
  única entrada em vez de duplicar. Confrontos adicionados manualmente continuam com id
  aleatório (sem esse risco de corrida).

**Bug de ordenação encontrado e corrigido durante os testes**: o handler de troca de fase ativa
zerava o "guard" de intervalo *depois* de `saveState()`, mas `saveState()` já dispara uma
re-renderização síncrona — a re-renderização em cascata lia o valor antigo do guard e podia
pular a sincronização da fase recém-selecionada. Corrigido invertendo a ordem.

11 testes automatizados (Playwright, ESPN mockada): sem fase ativa não sincroniza; selecionar
fase dispara sincronização sem clique adicional; dois confrontos adicionados automaticamente;
TWO_LEG não fabrica placar; ids determinísticos; sincronização repetida não duplica; confronto
novo aparece automaticamente numa checagem seguinte; SINGLE_MATCH com resultado final da ESPN
preenche o placar mas nunca trava o confronto sozinho; Jogos reflete os confrontos automáticos.

`node --check`: OK (12 arquivos, 3 apps). `audit_scoring.py`: 5/5, sem impacto — nenhuma fórmula
de pontuação alterada, só a origem/automação do cadastro de confrontos.

## v3.2 — 2026-07-13

### Changed — Supabase habilitado (`database.enabled: true`)

Eduardo pediu para não deixar dados só em `localStorage` — especialmente relevante agora que este
app tem confrontos e picks reais em jogo (ESPN sync, v3.1). `database.enabled` ligado
(`js/config.js`), mesmo projeto/tabela Supabase que a Copa já usa (`bolao_state`, linha própria
via `stateId: "cdb2026"`). `localFallback: true` mantido — local-first com espelho remoto, não
substituído por dependência exclusiva do Supabase.

**Ação pendente do lado do Supabase (fora do alcance desta sessão):** as policies de RLS só
liberavam `id='main'` — SQL para estender aos três apps em
`docs/bolao/DATABASE_SETUP_SUPABASE.md` "Múltiplos apps na mesma tabela", precisa ser rodado uma
vez no painel do Supabase por Eduardo. Até lá, o app continua funcionando normalmente em modo
local (testado com a resposta do Supabase mockada como 403 — nenhum erro não tratado, nenhuma
perda de dado local).

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto (mudança de infraestrutura, não de
scoring).

## v3.1 — 2026-07-13

### Added — sincronização com a ESPN no admin ("Buscar da ESPN")

Eduardo reportou que os confrontos "desapareceram" depois da reformulação v3.0 — comportamento
esperado do novo modelo (fases começam vazias, `data.js` não tem mais bracket fixo, ver v3.0
abaixo), mas frustrante de popular manualmente jogo a jogo. Pediu para buscar os dados reais e
também automatizar a atualização após cada sorteio.

**Nova ferramenta no admin** ("Fases e confrontos" → "Sincronizar com a ESPN"): busca sob
demanda no scoreboard da ESPN (`site.api.espn.com`, liga `bra.copa_do_brazil`), lista os jogos
encontrados (times, data, placar se já finalizado) e deixa o admin escolher a fase e confirmar
cada confronto individualmente antes de qualquer gravação — **nada é salvo automaticamente**.
Jogos cujo par de times já existe em alguma fase aparecem marcados "já cadastrado" e não são
oferecidos de novo. Partida única já finalizada na ESPN tem o placar pré-preenchido no mesmo
formato usado pelo lançamento manual de resultado (evita redigitar).

Desenho deliberadamente diferente do polling automático em segundo plano do BR2026: a Copa do
Brasil é mata-mata sem "ao vivo" contínuo a manter sincronizado, e cada confronto aqui decide
dinheiro real — um clique explícito do admin por confronto é mais seguro que qualquer gravação
silenciosa. Ver `docs/bolao/CDB2026_RULES_AND_MODEL.md` "Sincronização com ESPN".

**Limitação registrada:** o ambiente onde este recurso foi desenvolvido não tem acesso de rede a
hosts externos (`site.api.espn.com` bloqueado pela política de proxy do sandbox), então o slug
`bra.copa_do_brazil` foi confirmado apenas via busca pública (não testado com uma chamada real) —
**testar no primeiro uso real, no navegador do Eduardo.** Também corrigido, no mesmo commit, um
bug real e independente: a CSP do `index.html` do CDB2026 não incluía `site.api.espn.com` em
`connect-src` — sem essa correção, o fetch teria sido bloqueado pelo próprio navegador mesmo em
produção, com ou sem sandbox.

Testado via mock do endpoint da ESPN (Playwright): busca lista candidatos corretamente, ordena
por data, times já cadastrados não se repetem, criação de confronto TWO_LEG não inventa placar
para jogo ainda não realizado, confronto SINGLE_MATCH com placar final da ESPN pré-preenche o
resultado, e o confronto aparece na aba Jogos assim que adicionado — 8/8 testes passando.

`node --check`: OK (12 arquivos, 3 apps). `audit_scoring.py`: 5/5, sem impacto — nenhuma fórmula
de pontuação ou critério oficial foi alterado, só a origem dos dados de confronto (ESPN em vez de
digitação manual, sempre confirmada pelo admin).

## v3.0 — 2026-07-13

### Reformulação completa do modelo — bracket fixo estava errado para a Copa do Brasil real

Eduardo apontou (com o regulamento oficial da Copa do Brasil 2026 em mãos) que o modelo usado
desde a v2.0 estava incorreto: copiava a estrutura de mata-mata fixo da Copa do Mundo (16
times, 15 confrontos definidos no código desde o início, ida+volta em tudo exceto a final) em
vez de modelar a competição real — **126 clubes, 9 fases, 1ª–4ª e a Final em partida única, só
5ª–8ª (incluindo a Semifinal) em ida e volta, com sorteios progressivos a cada fase**, não um
chaveamento pré-conhecido. Auditoria completa, relatório e proposta de modelo em
`docs/bolao/CDB2026_RULES_AND_MODEL.md` (fonte oficial do modelo a partir de agora) — 4
perguntas de confirmação respondidas por Eduardo antes de qualquer código ser escrito.

**Reescrita completa do app** (`js/data.js`, `js/app.js`, `js/i18n.js`, `js/config.js`,
`css/styles.css`, `index.html`):

- **Fases dinâmicas, não bracket fixo.** `data.js` agora só declara as 9 fases (nome, formato,
  ordem) — isso é regulamento, não muda durante o torneio. Confrontos e partidas **não** ficam
  mais em `data.js`: vivem no estado (`s.phases[faseId].ties`), cadastrados pelo admin conforme
  cada sorteio real acontece. Nenhuma fase vem pré-populada — todas nascem "Aguardando sorteio
  oficial", inclusive a 1ª Fase.
- **Palpite por partida, nunca agregado digitado direto.** Antes, o participante digitava um
  "placar agregado" como se fosse uma partida só, mesmo em confrontos de ida+volta. Agora cada
  jogo (ida, volta, ou partida única) tem seu próprio placar palpitado, e o agregado é sempre
  **calculado ao vivo** conforme os dois campos são preenchidos — nunca digitado.
- **Pontuação por partida** (mutuamente exclusiva: placar exato **10** substitui resultado certo
  **5**, que substitui gols de um time certos **1** por lado — nunca soma) **+ bônus de 5 pts
  por confronto** por acertar quem se classifica (separado do placar) **+ campeão 30 / vice 20**
  (mantidos no valor atual, Eduardo optou por não mudar para 25/15 como o regulamento sugeria
  inicialmente). Sem bônus de 3º/4º lugar — nunca existiu na Copa do Brasil.
- **Cutoff por fase**, não mais um valor único global — cada fase tem seu próprio prazo,
  definido pelo admin ao cadastrar os confrontos daquela fase.
- **Admin ganhou uma tela nova** ("Fases e confrontos"): cadastrar confronto (2 times, formato
  herdado da fase), definir prazo por fase, remover confronto antes de ter resultado. Entrada de
  resultado (Jogo 1/Jogo 2 ou partida única) generalizada para funcionar com confrontos
  dinâmicos — mesmo padrão de UI da v2.9, só que os confrontos agora nascem do cadastro do
  admin, não de `data.js`.
- **Regras reescrita** com os dois exemplos concretos do pedido original (ida+volta decidida nos
  pênaltis mantendo o agregado 2×2; partida única decidida nos pênaltis mantendo 1×1),
  explicando partida vs. confronto, ausência de gol fora, cutoff por fase.
- **Probabilidades adaptada** para iterar os confrontos dinâmicos já sorteados (em vez de um
  bracket fixo), cobrindo os dois formatos (partida única e ida+volta); time cadastrado pelo
  admin sem rating conhecido usa um valor neutro em vez de quebrar a estimativa.
- **Ranking**: detalhamento por partida (ida/volta separados) + bônus de classificado + campeão/
  vice, cada linha com o placar palpitado e os pontos ganhos.

**Não migrado / reescrito do zero:** confirmado com Eduardo que não existem entradas reais
(`database.enabled` continua `false`, app nunca publicado) — sem necessidade de conversão de
dado antigo ou versionamento de regras retroativo.

**Fora de escopo desta rodada** (registrado como dívida técnica, não esquecido):
jogo adiado/cancelado/remarcado não tem tratamento dedicado (fica como partida sem placar até o
admin decidir manualmente); nenhum log de auditoria de alterações administrativas; nenhuma
integração esportiva externa (a Copa do Brasil não tem uma, dado real diverso de 126 clubes).

**QA:** `node --check` limpo em todos os `.js`. `audit_scoring.py`: 5/5, sem impacto (mudança
isolada ao CDB2026). Testado via Playwright: cadastro de confronto (partida única e ida+volta),
placar salvo por jogo, agregado calculado corretamente ao vivo (formulário de palpite E painel
admin), confronto empatado exige escolha manual de classificado (testado nos dois formatos, com
os valores exatos do exemplo do pedido — Flamengo × Palmeiras 2×2 nos pênaltis, Corinthians ×
Grêmio 1×1 nos pênaltis), confronto não-empatado trava automaticamente, pontuação testada em
todos os níveis (exato/resultado/lado/bônus de classificado/campeão/vice) com total calculado à
mão batendo exatamente (86 pontos num cenário misto), fase com cutoff no passado bloqueia
palpite, export CSV/JSON não quebram, nenhum erro de JS em nenhum fluxo, zero overflow
horizontal (320–1440px) na nova tela de admin.

Não altera `bolao/` (Copa do Mundo) nem `bolao/br2026/` (Brasileirão) — confirmado por escopo de
arquivo (só `bolao/cdb2026/*` e `docs/bolao/CDB2026_RULES_AND_MODEL.md` tocados).

## v2.9 — 2026-07-13

### Fixed — admin só deixava lançar o resultado do jogo de ida, não da volta

Reportado por Eduardo. Causa: `renderAdminResults()` tinha só UM par de campos de placar por
confronto, sem noção de "ida"/"volta" — era pensado como entrada direta do AGREGADO. Na
prática isso obriga o admin a esperar os dois jogos acontecerem e somar o placar de cabeça
antes de conseguir digitar qualquer coisa, e o campo único "parece" ser só do jogo de ida
porque não há onde lançar o segundo placar.

Fix: cada confronto agora tem duas linhas de entrada independentes — **Jogo 1 (ida)** e
**Jogo 2 (volta)** — cada uma salva seu placar assim que aquele jogo termina
(`s.results.legs[tieId].leg1`/`.leg2`, campo novo no estado). Assim que as duas pernas têm
placar salvo, o agregado é calculado automaticamente e aparece um resumo com quem avança
(ou, se o agregado empatar, um seletor manual — mesma regra da CBF sem gol fora de casa já
usada no formulário de palpite: agregado empatado = pênaltis, imprevisível, o admin escolhe).
Só o clique explícito em "Salvar e travar resultado" grava o resultado oficial, que continua
sendo escrito em `s.results.ties[tieId]` **no mesmo formato de sempre** (`goalsA`, `goalsB`,
`advance`, `lockedAt`) — nada mudou na leitura desse dado por `resolveOfficial()`, ranking,
CSV ou qualquer outro consumidor. Destravar o resultado oficial não apaga mais o placar de
cada perna (fica salvo para reaproveitar/corrigir), só o agregado travado.

Também corrigido `mergeStates()`/`state()`/`emptyState()`, que descartavam silenciosamente
`results.legs` num sync remoto (só carregavam `results.ties`) — não afetava nada hoje porque
`database.enabled` ainda é `false` neste app, mas teria apagado o placar por perna assim que
o Supabase fosse ativado.

**Não toca em scoring/pontuação/ranking** — só na forma como o admin chega ao mesmo objeto de
resultado que já existia. `node --check`: OK. `audit_scoring.py`: 5/5, sem impacto. Testado
via Playwright: salvar Jogo 1, salvar Jogo 2, agregado calculado corretamente (inclusive caso
empatado, exigindo escolha manual de quem avança), travar, destravar (pernas sobrevivem),
sem erro de JS em nenhum passo; regressão em Ranking/Jogos/Probabilidades/Palpites limpa.

## v2.8 — 2026-07-13

### Fixed — escudo do time "nas pontas" em vez de flanquear o centro

Mesmo achado do Brasileirão (v1.22): o padrão canônico da Copa (`renderNextMatch()`, nome
fora / escudo dentro, `Time A 🏳 × 🏳 Time B`) não estava sendo seguido em `pick-pos-lbl`
(resumo de palpite no ranking), `leg-teams` (linhas Jogo 1/Jogo 2) e `confronto-header`
(título do confronto) — os três tinham escudo fora / nome dentro. Interessante: o formulário
de palpite (`tie-inputs`/`tie-locked-score`) já usava o padrão certo — a inconsistência era
só nas telas de leitura. Invertido nos três lugares para bater com a Copa.

### Added — aba "Probabilidades"

Faltava esta aba em comparação com o Brasileirão. Diferença de formato: aqui o confronto é
mata-mata ida+volta com placar agregado (não partida única/tabela), então a Copa/Brasileirão
não tinham simulador equivalente pronto para reaproveitar — matemática nova, mesma base
(Poisson bivariado + correção Dixon-Coles, igual aos outros dois apps):

- `bolao/cdb2026/js/data.js`: novo campo `strength` (força aproximada 0-100 de cada um dos
  16 clubes) — **valor inicial estimado, não uma fonte oficial; Eduardo deve revisar antes de
  publicar.** Não alimenta scoring/resultado real.
- Cada perna (ida/volta) tem seus gols esperados calculados a partir da força dos dois times
  + vantagem de mandante (+65 pontos numa escala tipo Elo, valor comum em modelos públicos de
  futebol de clubes — a Copa não usa isso, por ser seleção em sede neutra).
- O placar das duas pernas é combinado (convolução da distribuição completa de placar de cada
  uma) para chegar no agregado, aplicando a regra real da CBF já implementada no site (sem
  gol fora de casa — agregado empatado = pênaltis, tratado como 50/50 por não ser previsível
  por modelo de gols).
- Barra de probabilidade de 2 vias (sem empate — o confronto sempre resolve em alguém
  avançando), mesmo componente visual `.prob-bars`/`.prob-bar` dos outros dois apps.
- Nova seção `#probs` + botão de navegação, ordem igual ao Brasileirão (depois de "Jogos").
- Confrontos já decididos (resultado oficial lançado) mostram quem avançou em vez de uma
  probabilidade — não faz sentido estimar o que já é fato.

Não toca scoring/resultado oficial em nenhum momento — é só uma exibição informativa
calculada em cima da mesma força de time estática, sem gravar nada em `localStorage`/Supabase.

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto de scoring. Testado via Playwright
(mock de dado local, sem rede) — aba renderiza sem erro JS, percentuais somam 100%.

## v2.7 — 2026-07-13

### Fixed — topbar quebrava horizontalmente no mobile

Reportado com screenshots: página cortada/deslocada horizontalmente no celular. Mesma causa raiz e mesmo fix do bolão da Copa e do Brasileirão (`bolao/css/styles.css`, `bolao/br2026/css/styles.css`): o seletor de bolão competia por espaço com marca+WhatsApp numa única linha que não cabe em nenhum celular, e `grid-template-columns` sem `minmax(0, 1fr)` não deixava os itens encolherem de verdade. Seletor agora tem linha própria no mobile; grid do topbar/navegação usa `minmax(0, 1fr)`; subtítulo da marca escondido no mobile; `.pick-pts-hint` (dica de pontuação) não força mais `nowrap`.

Não encontrei escudo de time dentro das barras de probabilidade neste bolão (diferente do Brasileirão) — nada a corrigir nessa frente aqui.

QA: 9 larguras testadas (320-1440px), zero overflow horizontal. `python3 bolao/scripts/audit_scoring.py` (bolão da Copa): sem impacto, mudança isolada à Copa do Brasil.

---

## v2.6 — 2026-07-13

### Fixed — fechamento da tarefa "Copa como referência canônica"

- `.admin-toolbar` gap/margin alinhados com a Copa (`8px`/`14px`, era `6px`/`8px`).
- `.admin-row` **mantido** como lista densa — mesma decisão do BR2026, ver
  `docs/bolao/CONSISTENCY_MATRIX.md` item 78.

Ver `docs/bolao/DESIGN_SYSTEM.md` para a tabela de mapeamento completa e a tabela de
validação (sem captura visual real — sem navegador disponível, tudo verificado por CSS).

`audit_scoring.py`: 5/5 — só CSS.

## v2.5 — 2026-07-12

### Fixed — bugs reais reportados testando o site ao vivo

- **Mandante/visitante trocados no jogo de volta**: a linha "Jogo 2" da aba Jogos sempre
  mostrava a mesma ordem do "Jogo 1", mas no jogo de volta o mandante é o outro time (ex.:
  Vasco manda a ida, Fluminense manda a volta). `legHtml()` usava os campos estáticos de
  `tie.leg2` (que só existem pras oitavas) em vez dos nomes já resolvidos do bracket; agora
  inverte `home`/`away` explicitamente pro leg2, funciona em qualquer fase.
- **Escudo só aparecia no cabeçalho do confronto**: as linhas "Jogo 1"/"Jogo 2" individuais
  não tinham escudo, só o cabeçalho do card. Adicionado nas duas.
- **Card "Já enviei meus palpites" não escondia por completo**: o fix anterior só escondia os
  campos, mas o título e o texto explicativo continuavam visíveis mesmo com o card bloqueado
  — mostrava duas mensagens conflitantes na tela. Agora o card inteiro (`#findEntryCard`) fica
  escondido até as oitavas terminarem, com `class="hidden"` já no HTML estático (sem flash
  antes do JS carregar).
- **Palpite por confronto reorganizado numa linha só**: time + escudo + placar × placar +
  escudo + time, em vez de nome dos times numa linha e placar numa linha separada abaixo.
  "Quem avança" continua abaixo, numa linha própria.
- **"Quem avança" agora segue a regra real da CBF**: sem critério de gols fora de casa — se o
  agregado tem lado claramente maior, quem avança é automático e o campo fica travado (sem
  edição manual, não faz sentido escolher o que a regra já decide). Se o agregado empata, vai
  pra pênaltis (imprevisível) — o campo destrava e o participante escolhe manualmente. Alternar
  entre os dois estados nunca deixa uma seleção antiga (automática ou manual) inválida sobrar;
  ao editar uma entrada já salva, a escolha manual de um agregado empatado é preservada, só uma
  edição ativa do placar limpa o valor.
- **Alinhamento dos 4 selects de pódio (campeão/vice/semis)**: sem largura fixa, a borda
  direita de cada `<select>` ficava numa posição horizontal diferente dependendo do tamanho do
  nome do time selecionado ("Remo" vs "Athletico-PR"). `width:100%` explícito nos quatro.
- **Botão WhatsApp**: texto visível era só "WhatsApp"; Copa usa "Suporte WhatsApp". Alinhado.
- **Card de pagamento sem ícone**: mesmo fix do BR2026 (ver `bolao/br2026/CHANGELOG.md`
  v1.19) — `cashapp.svg`/`venmo.svg` copiados, `payIcon()` portado, `.pay-grid`/`.pay-card`
  migrados pro layout da Copa.
- **Spinner nativo removido** dos inputs numéricos (mesmo fix nos três apps).

`audit_scoring.py`: 5/5 — a mudança na regra de "quem avança" é só na UI (trava/destrava e
auto-preenche o campo); a lógica de pontuação (`scoreEntry`) já comparava `pick.advance` contra
`res.advance` sem nenhuma suposição sobre como o campo foi preenchido, nada mudou lá.

## v2.4 — 2026-07-12 (WIP — commit parcial)

### Fixed — Copa como referência visual canônica (início; tarefa incompleta)

Início da padronização com a Copa (`bolao/`) como referência visual canônica — ver
`bolao/br2026/CHANGELOG.md` v1.18 para o racional completo (mesma mudança aplicada aos dois
apps). Commit parcial por limitação de créditos da sessão — auditoria completa ainda pendente.

- **`main` max-width**: `860px` → `1140px`, igual à Copa. `.confronto-card` já usava a classe
  `.card` compartilhada, nenhuma mudança necessária lá.

`audit_scoring.py`: 5/5 — só CSS.

## v2.3 — 2026-07-12

### Added — sistema de toast + badge/status unificado + ranking reestruturado (findings Critical/High autorizados)

Mesma rodada aplicada ao BR2026 nesta versão — ver `bolao/br2026/CHANGELOG.md` v1.17 e
`docs/bolao/CONSISTENCY_MATRIX.md` itens 67-69 para o racional completo.

- **Badge/status unificado**: `.paid-badge`/`.unpaid-badge` ganharam `border-radius:999px`/
  `padding:4px 10px`/`font-weight:900` (eram `6px`/`3px 8px`/`700`), mesmo tratamento do
  `.status-chip` da Copa. CDB2026 não tem chip de status de jogo (não tem API ao vivo) —
  gap já catalogado, não resolvido nesta rodada (é feature nova, não harmonização).
- **Sistema de toast portado da Copa**: `showToast()` + CSS `.bolao-toasts`/`.bolao-toast`.
  Convertidos os `alert()`s de confirmação/erro (salvar entrada, "buscar minha entrada",
  admin login/lockout, sync, resultados) — validação de campo obrigatório continua `alert()`.
  O comprovante deixou de duplicar o código no `alert()` de sucesso — `renderReceiptBox()` já
  mostra o código de forma persistente na tela, o toast só confirma o salvamento.
- **Ranking reestruturado**: `.rank-card` empilhado substituído pelo `.rank-row` denso de 1
  linha da Copa + `.picks-detail` expansível por clique (mesmo padrão de `bolao/js/app.js`).
- Nova chave i18n: `viewPicks`.

`audit_scoring.py`: 5/5 — mudança é de apresentação/interação, nenhuma fórmula de scoring ou
critério de desempate foi tocado.

## v2.2 — 2026-07-12

### Fixed — patches mínimos de design system (auditoria de UX cross-app)

Parte dos findings de baixo risco do `docs/bolao/DESIGN_SYSTEM.md`, CSS-only:

- **`h1,h2,h3` normalizado globalmente** — mesma regra da Copa portada (idêntica ao fix
  aplicado no BR2026 na mesma versão desta rodada, ver `bolao/br2026/CHANGELOG.md` v1.16).
- **Botão sticky (`.sticky-submit button`)**: sombra `rgba(0,0,0,.5)` → `rgba(47,229,110,.35)`
  (verde, igual à Copa) — `min-width:200px` já existia.
- Input/select/label e `.rules-table` padding já batiam com a Copa antes desta rodada.

Findings maiores (badge/status, ranking, toast) não implementados nesta rodada — ver
`bolao/CHANGELOG.md` v4.126 para o racional completo.

`audit_scoring.py`: 5/5 (só CSS).

## v2.1 — 2026-07-12

### Fixed — símbolo de time trocado por escudo real; edição só após oitavas

Reportado por Eduardo testando o site ao vivo, logo após o v2.0:

- **Escudo real em vez de bolinha com iniciais**: o badge colorido com abreviação (`teamBadge`)
  foi substituído por `teamLogoImg()` — mesmo nome de função, mesmas classes CSS
  (`.team-logo` 14px / `.match-logo` 22px) e mesmas medidas do `bolao/br2026/js/app.js`. As
  URLs são as mesmas que o BR2026 busca ao vivo do endpoint de standings da ESPN
  (`site.api.espn.com/.../soccer/bra.1/teams` para 14 dos 16 times; Fortaleza e Juventude
  estão na Série B nesta temporada — `bra.2` — verificado time a time, não assumido). Como o
  CDB2026 não tem nenhuma chamada de API ao vivo, as URLs ficam fixas em `DATA.teamLogos`
  (`js/data.js`) em vez de buscadas dinamicamente — mesmo resultado visual do BR2026, sem
  adicionar uma dependência de API nova a um app que hoje é 100% estático. CSP (`img-src`)
  atualizado para permitir `a.espncdn.com`, igual ao BR2026.
- **Edição própria só abre depois das Oitavas**: o card "Buscar minha entrada" ficava sempre
  visível, mesmo antes de qualquer confronto ser resolvido — nesse ponto não há nada de novo
  pra editar (Quartas em diante ainda não têm times definidos), então só confundia quem estava
  enviando a entrada pela primeira vez. Agora o card mostra uma mensagem explicativa e só
  libera o formulário depois que os 8 confrontos das Oitavas tiverem resultado lançado pelo
  admin (`oitavasComplete()`), com a mesma checagem repetida no clique do botão como segunda
  camada.

Aplicada a regra de comparação de componente visual (nova em `CLAUDE.md`): o mesmo bug de
`<img>` sem `width`/`height` explícito existia potencialmente no BR2026 também — ver o
changelog daquele app nesta mesma data.

`audit_scoring.py`: 5/5 (Copa não tocada).

## v2.0 — 2026-07-12

### Novo — palpites por confronto (placar agregado ida+volta), símbolos de time, comprovante

Reformulação pedida por Eduardo: regras similares à Copa do Mundo (placar por jogo, 10/5/1
pts), com a diferença de que os times de Quartas/Semifinal/Final só se definem — e só ficam
liberados para palpite — conforme a fase anterior termina.

- **Palpites por confronto**: além dos 4 palpites de pódio (campeão/vice/2 semifinalistas —
  mantidos travados desde antes do cutoff global, igual à Copa: se o time cai, o bônus é
  perdido, sem chance de trocar depois), agora existe um palpite de **placar agregado**
  (ida+volta) para cada um dos 15 confrontos do bracket (8 oitavas + 4 quartas + 2 semifinal +
  1 final). Pontuação por confronto: 10 pts placar exato / 5 pts quem avança certo / 1 pt um
  dos dois lados do agregado certo — mesmos valores da Copa do Mundo (`bolao/js/config.js`),
  aplicados ao agregado.
- **`js/data.js`**: bracket completo (`DATA.ties`), com Quartas/Semifinal/Final como slots
  `home:null/away:null` que resolvem dinamicamente a partir do resultado do confronto anterior
  (`fromHome`/`fromAway`) — mesmo padrão de resolução de bracket da Copa do Mundo. Datas e
  emparelhamento de Quartas em diante são placeholder até a CBF confirmar o chaveamento real.
- **Reabertura de palpites fase a fase**: cada confronto tem seu próprio `cutoffIso` (1h antes
  do jogo de ida); um confronto só aparece pra palpitar quando os dois times já estão
  resolvidos E o cutoff dele ainda não passou. Participante edita a própria entrada
  (auto-atendimento, ver abaixo) para preencher os confrontos liberados conforme cada fase
  termina.
- **Símbolo do time**: badge circular colorido com abreviação de 3 letras (`teamBadge()`),
  cor determinística por nome de time (sem depender de API externa/logo real, já que o
  CDB2026 não tem integração ao vivo). Aplicado nos jogos, no formulário de palpites e no
  ranking — não só numa barra de probabilidade (a Copa do Brasil nem tem barra de
  probabilidade; ver também o fix equivalente no Brasileirão nesta mesma sessão).
- **Comprovante (novo — antes o app não tinha nenhum)**: código no formato
  `CDB2026-XXXXXXXX-YYYYMMDD`, mesmo algoritmo FNV-32 (`hashString`) da Copa do Mundo. Exibido
  na tela após salvar e incluído no e-mail de confirmação.
- **Editar minha entrada (auto-atendimento)**: campo "e-mail + código do comprovante" na aba
  Palpites — e-mail sozinho não é considerado segredo suficiente (é visível para o admin e
  seria fácil de adivinhar/coletar), então a edição exige os dois.
- **Botão WhatsApp** no topbar, reaproveitando o mesmo grupo/QR/ícone da Copa do Mundo
  (`assets/whatsapp.svg`, `assets/whatsapp-group-qr.png`) — resolve a divergência `MISSING`
  catalogada em `docs/bolao/CONSISTENCY_MATRIX.md` item 34.
- **QR code Zelle** no card de pagamento (`assets/zelle-qr.png`, reaproveitado da Copa) —
  resolve item 36 da matriz.
- **Admin**: export JSON de backup (`💾 JSON`) e botão "Limpar tudo" (`🗑️`) — resolvem itens 16
  e 7 da matriz. Resultado de cada confronto agora é lançado individualmente pelo admin
  (placar agregado + quem avança), não mais como um único "resultado final" travado de uma vez.
- **CSV**: agora usa `\r\n` (CRLF) em vez de `\n` — resolve item 14 da matriz (regressão do bug
  já corrigido na Copa em v3.0); inclui uma coluna por confronto.

### Ainda não implementado (dívida técnica registrada)

- Sem `audit_scoring.py` equivalente para o CDB2026 (item 1 da matriz) — o novo modelo de
  scoring por confronto + bônus de pódio ainda não tem uma suíte de auto-teste dedicada.
- Sem `AbortController`/timeout nas chamadas Supabase (item 50 da matriz).
- Sem badge de status "ao vivo"/"finalizado" nos jogos (item 44 da matriz) — o CDB2026 não tem
  API externa, então o status vem só de o resultado ter sido lançado ou não pelo admin.

## v1.6 — 2026-07-12

### Novo — seção Jogos (Oitavas de Final) + times reais populados

- **Jogos**: nova aba no nav com os 8 confrontos das Oitavas de Final (ida e volta)
  - Exibe stadium, data e horário em BRT para cada jogo
  - Dados estáticos em `js/data.js` (não depende de API externa)
- **Times**: `js/data.js` atualizado com os 16 times reais das Oitavas:
  Athletico-PR, Atlético-MG, Chapecoense, Corinthians, Cruzeiro, Fluminense,
  Fortaleza, Grêmio, Internacional, Juventude, Mirassol, Palmeiras, Remo, Santos, Vasco, Vitória
- **CSS nav**: `repeat(6, 1fr)` → `repeat(7, 1fr)` para acomodar novo botão
- `audit_scoring.py`: 5/5.

---

## v1.5 — 2026-07-12

### Novo — botões de idioma no topbar (padronização com Copa)

- Adicionado `lang-links` ao topbar: PT-BR ativo, ES-MX e EN-US desabilitados
- CSS `.lang-links button` adicionado (pill style, igual Copa e BR2026)
- Desktop: grid `1fr auto auto` → brand | lang | switcher
- Mobile: brand | switcher (row 1) → lang (row 2) → nav (row 3)
- `audit_scoring.py`: 5/5.

---

## v1.4 — 2026-07-12

### Fixed — alinhamento topbar

- `align-items: center` no grid do topbar (desktop e mobile)
- `audit_scoring.py`: 5/5.

---

## v1.3 — 2026-07-12

### Fixed — segurança + CSS (Big Tech QA audit)

- **SEC LOW-1**: whitelist antes de `location.href` no switcher de bolão
- **CSS MOB-3**: `-webkit-backdrop-filter` adicionado (blur do topbar no iOS Safari ≤ 15)
- `audit_scoring.py`: 5/5.

---

## v1.2 — 2026-07-12

### Design — padronização 100% com a Copa do Mundo (auditoria sistemática)

Mesmas 11 correções do BR2026 v1.9, adaptadas para 6 botões no nav (`repeat(6, 1fr)`). `audit_scoring.py`: 5/5.

---

## v1.1 — 2026-07-11

### Fixed
- **Bug crítico de pontuação**: `scoreEntry()` usava `semiSet = new Set(results.semis)` para checar semifinalistas, ignorando campeão e vice-campeão que também chegaram ao Final Four. Corrigido para usar `semifinalistSet` (que inclui todos os 4 finalistas). Palpite no semifinalista que acerta o campeão agora recebe os 10 pts corretos.
- **Email throttle**: `_lastEmailTs` agora é marcado somente *após* o `await emailjs.send()` ter sucesso (com try/catch). Antes, uma falha de rede consumia o throttle de 30s e o usuário não conseguia retentar.
- **iOS Safari — switcher**: `appearance: none; -webkit-appearance: none` adicionados ao `.bolao-switcher select`. No iOS Safari o seletor agora respeita `border-radius: 999px` e a cor de fundo customizada.

## v1.0 — 2026-07-11

### Initial release
- **Palpites**: campeão, vice-campeão e 2 semifinalistas (4 dropdowns com mutual-exclusion)
- **Pontuação**: campeão exato = 30pts · vice exato = 20pts · semifinalista no Final Four = 10pts cada · máx. 70pts
- **Tiebreaker**: campeão acertado → vice acertado → nome Z→A
- **Ranking**: pontuação final quando admin trava resultado; sem ranking provisório (bolão de cup, não de liga)
- **Admin**: lock/unlock de resultados, marcar pagamentos, editar/apagar entradas, CSV export, Sync Supabase
- **EmailJS**: comprovante ao participante + notificação ao admin (mesmos templates dos outros bolões)
- **Supabase**: pronto para habilitar (`database.enabled: true` após criar row `id='cdb2026'`)
- **Bolão switcher**: dropdown no header para navegar entre Copa do Mundo, Brasileirão e Copa do Brasil
- **Melhorias incluídas desde o início**:
  - `preferRemoteResults` no merge de estado (equivalente ao Copa v4.108)
  - `document.hidden` guard no countdown (sem CPU em background)
  - Seção padrão = Ranking quando prazo passou (equivalente ao Copa v4.104)
  - Tiebreaker Z→A (equivalente ao Copa v4.105)
  - Auto-sync 30s quando Supabase habilitado (equivalente ao Copa v4.108)
- **Times**: placeholder com 8 clubes — Eduardo deve atualizar `js/data.js` com os quarterfinalsitas reais após o sorteio
- Não publicado ainda (sem link a partir do site principal)
