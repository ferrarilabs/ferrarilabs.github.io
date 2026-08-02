# Bolão Copa do Brasil 2026 — CHANGELOG

## v3.75 — 2026-08-02 — Tab nav: `aria-current="page"` on the active section button

Propagated from Copa (v4.164) per the Fase 2.2 visual/accessibility audit
(`docs/bolao/VISUAL_PARITY_MATRIX.md`): `showSection()` now toggles `aria-current="page"` on the
active `.nav button[data-section]` (removed on the rest), same shape as Copa/BR2026. No visual
change, no scoring/logic touched. `audit_scoring.py`: 5/5.

## v3.74 — 2026-08-02 — Aba "Jogos" alinhada 100% ao look and feel/comportamento da Copa: chips de status, placar ao vivo, auto-scroll pro próximo jogo

Eduardo: "A tab jogos da cdb e brasileirão devem funcionar da mesma maneira que copa do mundo e
ter o mesmo look and feel. E por default deve ir automaticamente para o próximo jogo. verifique
isso 100% sem retirar informações ou funcionalidades." Auditoria confirmou: BR2026 já tinha esse
comportamento (código idêntico ao padrão da Copa) — só faltava no CDB2026. Três gaps reais
encontrados e corrigidos, nenhuma informação existente removida:

1. **Chip de status por perna** (`.game-status pre/live/post/postponed`) — CDB2026 só mostrava a
   data OU o placar cru, sem rótulo nenhum; Copa/BR2026 sempre mostram um chip colorido. Aplicado
   a toda perna, reaproveitando o CSS já portado (e nunca usado fora de "Adiado") desde a v3.26.
2. **Placar/relógio ao vivo dentro da aba Jogos** — uma perna em andamento continuava mostrando
   só a data antiga na lista de jogos, como se ainda não tivesse começado (só o card `#liveTieCard`
   isolado do topo mostrava o placar real). Agora consulta `_liveTies` e mostra placar + relógio
   ao vivo (já reconciliado pelo fix da v3.73) direto na perna, com borda vermelha igual ao
   `.game-card.is-live` da Copa.
3. **Auto-scroll pro próximo jogo ao abrir a aba** — não existia. Novo `nextUpcomingLegKey()`,
   que reusa `flatLegsChronological()` (ordem cronológica real por PERNA, não por confronto, já
   usado por "Ver palpites"/comprovante/CSV desde a v3.67) em vez do "primeiro `.pre` em ordem de
   DOM" que basta pra Copa/BR2026 — como o CDB2026 agrupa ida+volta no mesmo card por confronto, a
   volta (ainda sem data) de um confronto já iniciado apareceria ANTES da ida de outro confronto
   com data mais próxima se só a ordem de DOM fosse usada. Exclui pernas já ao vivo (mesmo
   critério de Copa/BR2026 — o jogo ao vivo já tem destaque próprio no topo).

**Estrutura de card por CONFRONTO (ida+volta agrupadas, com agregado/"quem avança") preservada
integralmente** — é `TOURNAMENT_SPECIFIC` (mata-mata de duas pernas, sem equivalente na Copa/
BR2026), não uma divergência a remover. Nenhuma informação existente foi tirada (venue, agregado,
classificado, rótulo ida/volta, chip de adiado — todos continuam, só ganharam o chip de status
novo ao lado).

Verificado com Playwright contra estado real de produção + partida ao vivo simulada (mesmo mock
Santos × Remo da v3.73): confronto-cards/agregados/"quem avança" idênticos a antes; chip de status
em toda perna confirmado; placar+relógio ao vivo com borda vermelha confirmado na perna ao vivo;
auto-scroll confirmado levando à perna correta (excluindo a que já está ao vivo). `node --check`:
OK. `audit_scoring.py` das 3 apps (5/5 cada), `audit_golden_master.mjs` (37/37) e
`audit_integrity.py` (0 erro) re-rodados — scoring não tocado, só exibição/navegação da aba Jogos.

## v3.73 — 2026-08-02 — Relógio ao vivo mostrava acréscimo menor do que um lance já listado abaixo dele

Eduardo, print do card ao vivo: "O cronometro esta errado, veja que mostra +1 mas logo abaixo
teve lances bem depois desse tempo." Confirmado: relógio mostrava "90:11 (+1)" com um lance já
listado logo abaixo em "90'+5'" — 5 minutos de acréscimo já confirmado, mas o relógio ainda dizia
só 1. Causa: o relógio usa `comp.status.clock` da ESPN (via `formatMatchClock()`), enquanto a
lista de lances usa `details[].clock.value`/`keyEvents[].clock.value` de cada evento
(`extractMatchPlays()`) — dois campos DIFERENTES da mesma resposta da ESPN, que às vezes vêm fora
de sincronia entre si (o campo do relógio geral atrasado em relação ao timestamp de um evento já
confirmado), principalmente perto do fim do tempo normal/acréscimos. Não é bug de polling nem de
interpolação local daqui — é a própria ESPN reportando os dois campos com valores diferentes na
mesma resposta.

Corrigido em `pollLiveTies()`: depois de calcular o relógio mesclado (`mergeLiveClock()`), compara
com o `clock.value` mais recente entre os lances já extraídos (`ev.plays`) e usa o maior dos dois
— o relógio exibido nunca mostra menos tempo decorrido do que um lance que já está listado abaixo
dele. Só ajusta o número usado no relógio; não mexe em `clockPaused`/`isHalftime`/`isPenalties`
nem na lógica de detecção de pausa (`detectClockPaused()`), que tem histórico próprio de ajuste
fino (ver v3.6x) e não fazia parte do problema reportado aqui.

Reproduzido com Playwright + mock de partida ao vivo (Santos × Remo, `status.clock` propositalmente
atrasado em relação ao `clock.value` dos 3 lances do print, mesmos textos/times/minutos):
relógio ia de "90:11 (+1)" pra "95:03 (+6)" depois da correção, batendo com o lance mais recente
("90'+5'") em vez de ficar atrás dele. `node --check`: OK. `audit_scoring.py` das 3 apps (5/5
cada), `audit_golden_master.mjs` (37/37, não testa este caminho — relógio ao vivo não afeta
`matchPoints()`/`scoreEntry()`) e `audit_integrity.py` (0 erro) re-rodados — scoring não tocado.

## v3.72 — 2026-08-02 — Side-scroll continuava permanente: contenção adicionada direto em .topbar e main

Eduardo, novo print (mesmo bug da v3.70/v3.71): "Still the same." Perguntei os detalhes que
faltavam pra não continuar chutando às cegas: confirmou que a rolagem horizontal é **permanente**
(a tela realmente fica mais larga, dá pra arrastar de um lado pro outro à vontade — não é um
solavanco que volta sozinho) e acontece **já ao carregar a página/trocar de aba**, não só ao
rolar. Isso descarta o diagnóstico de "bounce elástico" das duas versões anteriores — é overflow
REAL de algum elemento, e `overflow-x: clip`/`overscroll-behavior-x` em `html, body` não estavam
resolvendo porque não é (só) sobre o comportamento elástico do WebKit.

Não foi possível reproduzir no Chromium do sandbox mesmo simulando uma partida ao vivo real
(Santos × Remo com gol, cartão amarelo do Neymar e duas substituições, dados idênticos ao print)
contra o estado real de produção — `document.documentElement.scrollWidth` sempre igual a
`window.innerWidth`, nenhum elemento com `getBoundingClientRect()` ultrapassando a viewport.
Suspeita não confirmada (sem acesso a um dispositivo iOS real pra inspecionar): `.topbar` é o
único elemento `position: sticky` da página, e o comentário original da v3.36 já registrava que
`overflow-x: clip` em `html, body` pode não impedir um ancestral sticky de vazar overflow
horizontal em alguns motores.

Adicionada uma camada de contenção defensiva direto nos dois elementos mais próximos do
provável vazamento, já que não dá pra confirmar a causa exata sem o dispositivo real:
- `.topbar { width: 100%; overflow-x: hidden; overflow-y: visible; }`
- `main { overflow-x: hidden; overflow-y: visible; }` (o `overflow-y: visible` explícito é
  obrigatório nos dois — especificar só `overflow-x` faz o `overflow-y` computado virar `auto`
  pela regra do CSS2.1, o que transformaria esses elementos em scroll containers próprios e
  quebraria o `.sticky-submit` do formulário de palpites, corrigido na Fase 2.2).

Verificado com Playwright (estado real de produção + partida ao vivo simulada): página renderiza
igual, sem overflow detectável, `main`/`.topbar` mantêm o comportamento visual normal. **Ainda
não é uma confirmação de que isso resolve no dispositivo real do Eduardo** — sem um iPhone pra
testar, meu próximo passo se "still the same" persistir é pedir uma GRAVAÇÃO DE TELA (não só
print) pra ver o exato instante em que acontece.

`node --check`: OK (mudança só de CSS). `audit_scoring.py` das 3 apps (5/5 cada),
`audit_golden_master.mjs` (37/37) e `audit_integrity.py` (0 erro) re-rodados — scoring não
tocado.

## v3.71 — 2026-08-02 — Correção de diagnóstico: v3.70 dizia "Safari", era Chrome no iPhone

Eduardo: "This was on chrome not safari." A v3.70 (abaixo) atribuiu o side-scroll ao bounce
elástico do "iOS Safari" — impreciso. Confirmado com Eduardo: era Chrome no iPhone, não Safari.
**Isso não muda o motor real nem o fix**: a Apple obriga todo navegador no iOS (Chrome, Firefox,
etc.) a rodar sobre o WKWebView — o MESMO motor de renderização do Safari, com o mesmo bounce
elástico nativo. "Chrome no iOS" troca só a UI em volta da página (barra de endereço, abas), não
o motor que decide o bounce horizontal. O fix da v3.70 (`overscroll-behavior-x: none`/`contain`)
se aplica igual, independente de qual navegador iOS está sendo usado — nenhuma mudança de código
nesta versão, só correção da nota/comentário que dizia "Safari" especificamente (agora "iOS" /
"WKWebView", cobrindo qualquer navegador da plataforma). Comentário em
`bolao/cdb2026/css/styles.css` atualizado para registrar o histórico completo (diagnóstico
original + correção), em vez de reescrever silenciosamente.

`node --check`: OK (nenhum código tocado). `audit_scoring.py` das 3 apps: 5/5 cada, sem impacto.

## v3.70 — 2026-08-02 — Side-scroll horizontal (rubber-band do iOS Safari) voltou; reforçado com overscroll-behavior-x

Eduardo, print do Ranking: "O dimensionamento da tela voltou a ter esse problema de scroll
vertical" (visualmente é rolagem HORIZONTAL — texto alinhado à esquerda cortado, "Ranking"
aparecendo como "anking", "Pontuação" como "ontuação", conteúdo à direita como "POT $60" e a
tabela intactos). Mesma classe de bug já documentada e supostamente resolvida em v3.31/v3.36:
o `.topbar` (sticky + `backdrop-filter`, idêntico nos 3 apps) deixa o iOS Safari fazer um bounce
elástico horizontal na borda da página que `overflow-x: hidden`/`clip` sozinho não elimina 100%,
só reduz. A tabela "Ver palpites" ficou mais larga na v3.66 (4ª coluna, "Resultado real"), o que
deixa esse bounce mais perceptível ao arrastar dentro dela.

Reforçado com `overscroll-behavior-x` (mecanismo mais novo e mais direto — desliga o bounce
elástico do navegador em vez de só recortar seu efeito visual):
- `html, body { overscroll-behavior-x: none; }` (além do `overflow-x: clip` já existente).
- `.picks-detail { overscroll-behavior-x: contain; }` — impede que arrastar até a borda da
  tabela "encadeie" pro scroll da página inteira.

Não reproduzido no Chromium do sandbox (mesma limitação já registrada na v3.36 — esse bounce
elástico é específico do WebKit/iOS Safari, sem equivalente no Chromium). Copa e BR2026 têm o
mesmo `.topbar` e o mesmo `overflow-x: clip` sem `overscroll-behavior-x` — registrado em
`CONSISTENCY_MATRIX.md` como candidato ao mesmo reforço preventivo, não aplicado lá nesta tarefa
(não reportado nos outros dois apps; Copa é produção, só recebe patches avaliados
individualmente).

`node --check`: OK (mudança só de CSS). `audit_scoring.py` das 3 apps (5/5 cada),
`audit_golden_master.mjs` (37/37) e `audit_integrity.py` (0 erro) re-rodados — scoring não
tocado.

## v3.69 — 2026-08-02 — Card ao vivo (gols/cartões/substituições) puxava a rolagem pra cima sozinho a cada segundo

Eduardo: "Quando mexo no drop down onde mostra cartões substituição e gols ele fica voltando para
cima, rolo para baixo e fica puxando para cima. Isso foi corrigido na copa do mundo." A caixa
`.live-plays` (lista de gols/cartões/substituições do jogo ao vivo, `max-height:100px;
overflow-y:auto` — o "dropdown" rolável a que ele se refere) já tinha sido portada da Copa com a
CSS certa, mas SEM a parte de JS que preserva o `scrollTop` -- `renderLiveTieCard()` roda a cada
tick de 1s do relógio ao vivo (`setInterval` em `init()`) e reconstrói `card.innerHTML` inteiro
toda vez, recriando a caixa `.live-plays` do zero e zerando a rolagem dela. No meio de rolar pra
baixo pra ler cartões/substituições mais antigos, a caixa "puxa pra cima" sozinha a cada segundo.

Mesmo bug e mesmo fix já existente na Copa (`captureLivePlaysScroll`/`restoreLivePlaysScroll`,
`bolao/copa2026/js/app.js`) e no BR2026 (mesma lógica inline em `renderLiveTieCard()`,
`bolao/br2026/js/app.js` ~L1679-1687) — só faltava aqui. Portadas as duas funções e chamadas ao
redor do `card.innerHTML = ...` de `renderLiveTieCard()`: captura o `scrollTop` de cada caixa
`.live-plays[data-plays-match]` antes de reconstruir o HTML, restaura depois.

Sem jogo ao vivo no momento da mudança (Vasco × Fluminense já encerrado) para reproduzir com
Playwright contra um evento ao vivo real — verificado por leitura de código e comparação
funcional linha a linha contra a implementação já comprovada da Copa (mesmo padrão exato:
capturar antes do `innerHTML =`, restaurar depois, mesma chave `data-plays-match`). `node
--check`: OK. `audit_scoring.py` das 3 apps (5/5 cada), `audit_golden_master.mjs` (37/37) e
`audit_integrity.py` (0 erro) re-rodados — scoring não tocado, só rolagem de um widget de
exibição.

## v3.68 — 2026-08-02 — Removido rótulo "(Jogo de ida)"/"(Jogo de volta)" do Ver palpites e do comprovante

Eduardo: "Pode tirar jogo de ida e volta, as pessoas sabem disso pois a ordem do time está
correta." A ordem casa/fora dos nomes de time já identifica a perna (ex.: "Vasco × Fluminense"
é a ida, "Fluminense × Vasco" é a volta) — o sufixo era redundante nas duas telas
participante-facing que listam pernas: `renderPickDisplay()` (Ver palpites do Ranking) e
`receiptHtml()` (comprovante por e-mail). Removido dos dois.

`exportCsv()` (exportação do admin) **não** foi alterado — é ferramenta interna do Eduardo, não
"as pessoas" a quem a mensagem se refere, e o rótulo ajuda a escanear várias entradas numa linha
só sem precisar decorar a orientação casa/fora de cada confronto. `renderPickForm()`/
`renderGamesSection()` também não foram tocados — continuam com "(Jogo de ida)"/"(Jogo de volta)"
como cabeçalho de cada linha do cartão do confronto, onde o rótulo orienta qual perna aquele
campo/linha é (função diferente do "Ver palpites", que já lista os dois placares separados).

Reproduzido com estado real de produção (Playwright): confirmado que as linhas do Ver palpites
não têm mais o sufixo, mantendo a ordem cronológica da v3.67. `node --check`: OK.
`audit_scoring.py` das 3 apps (5/5 cada), `audit_golden_master.mjs` (37/37) e
`audit_integrity.py` (0 erro) re-rodados — scoring não tocado, só rótulo de exibição.

## v3.67 — 2026-08-02 — "Ver palpites" fora de ordem cronológica de novo: era ordenado por CONFRONTO, não por PERNA

Eduardo, print do Ranking → Ver palpites: "Mais um ajuste cirúrgico os jogos precisam ser em
ordem cronológica aqui." A v3.65 já tinha corrigido a ordenação de "crua/insersão" para
"cronológica", mas só no nível do CONFRONTO: `firstLegKickoffMs()` ordenava as TIES pela data da
ida e depois listava ida+volta daquele confronto sempre juntas, mesmo quando a volta ainda nem
tem data marcada (`null`) ou quando a volta de um confronto acontece antes da ida de outro. No
print, a volta (ainda sem data, `kickoff: null`) do Vasco × Fluminense aparecia logo depois da
ida do Vasco, na frente da ida do Atlético-MG × Juventude (que JÁ tem data e acontece antes) —
essa é a ordem "por confronto", não a ordem real dos jogos.

Corrigido com uma função nova, `flatLegsChronological(s, phase)`: em vez de ordenar confrontos e
listar as duas pernas de cada um juntas, agora monta uma lista achatada de TODAS as pernas de
todos os confrontos da fase e ordena essa lista pela data real de CADA perna individualmente
(pernas sem data ainda ficam no fim, na ordem em que já estavam — mesmo critério de antes).
Aplicada nas 3 telas que listam pernas numa tabela linear — as mesmas que ganharam o fix da v3.65
com o mesmo comentário de achado: `renderPickDisplay()` (Ver palpites do Ranking), `receiptHtml()`
(comprovante por e-mail) e `exportCsv()` (exportação do admin). A linha "Classificado" (aparece
quando o confronto já foi decidido) passou a ser emitida logo após a perna decisiva (a volta, ou
a única partida em fase de jogo único) em vez de sempre logo após a ida, acompanhando a nova
ordem. `renderPickForm()` (formulário de palpites) e `renderGamesSection()` (aba Jogos) **não**
foram alterados — cada um é propositalmente um cartão por confronto inteiro (ida e volta juntas),
não uma lista linear de jogos, então não tinham esse bug.

Reproduzido com estado real de produção (Playwright + Supabase): confirmado que as 8 idas
conhecidas agora aparecem em ordem real de horário (Vasco 01/08 17h30 → Atlético-MG 19h30 →
Santos 21h → Palmeiras 02/08 16h → Mirassol 18h → Chapecoense 18h30 → Internacional 19h30 →
Athletico-PR 03/08 21h), com as 8 voltas (ainda sem data) depois, em vez de intercaladas por
confronto. `node --check`: OK. `audit_scoring.py` das 3 apps (5/5 cada), `audit_golden_master.mjs`
(37/37) e `audit_integrity.py` (0 erro) re-rodados — scoring não tocado, só ordenação de exibição.

## v3.66 — 2026-08-01 — "Ver palpites" ganha coluna de resultado real (paridade estrutural com a Copa)

Eduardo, depois da v3.65: "The format needs to match 100% Copa do Mundo." Auditoria de estrutura
(não só peso de fonte desta vez): a tabela `picksTable()` da Copa sempre mostra o placar
palpitado **e** o resultado real lado a lado (colunas "Placar"/"Real"), pra quem está olhando
poder comparar os dois sem sair da tela. `renderPickDisplay()` do CDB2026 só mostrava o placar
palpitado — sem coluna nenhuma pro que realmente aconteceu em campo. Gap real, não só cosmético.

Adicionada coluna "Resultado real" (`receiptColReal`, novo em `i18n.js`) entre "Placar palpitado"
e "Pts", lendo `tie.matches[leg].goalsHome/goalsAway` (mesma orientação de casa/fora já usada por
`matchPoints()` — nenhum dado novo, só exposição do que já existe no estado). "—" quando o jogo
ainda não tem resultado, igual ao padrão da Copa (`hasRealScore ? ... : "—"`). Linha de
"Classificado" também ganhou a mesma coluna, mostrando quem realmente avançou (só depois de
`tie.qualifiedTeamId` setado). Linhas de campeão/vice previsto mostram "—" no lugar (não existe
"resultado real" pra bônus de pódio ainda não decidido).

Reproduzido visualmente com estado real de produção (Playwright + Supabase, entrada "Marcelo
Giovannetti #1"): confirmado que Vasco × Fluminense (jogo já disputado, 0×0) agora mostra "0 × 0"
na coluna Real ao lado do palpite "1 × 1", igual à Copa mostraria. `node --check`: OK.
`audit_scoring.py` das 3 apps (5/5 cada), `audit_golden_master.mjs` (37/37) e
`audit_integrity.py` (0 erro) re-rodados — scoring não tocado, só exibição.

## v3.65 — 2026-08-01 — Negrito inconsistente no "Ver palpites" do Ranking: alvo real era o destaque de linha por acerto/erro, não .tie-locked-score

Eduardo, depois da v3.64 (que só tocou `.tie-locked-score`, do formulário de palpites):
"Negrito e não negrito continua. Essa parte ai do ranking tem que ser exatamente com o mesmo
formato e ux da copa do mundo. Já discutimos isso. Verifique 100%!" — com print da tabela
"Confronto | Placar palpitado | Pts" do Ranking → "Ver palpites", que é `renderPickDisplay()`,
uma função **diferente** da que a v3.64 mexeu.

**Achado real (via reprodução visual com dados reais de produção, Playwright, não só leitura de
código):** comparação linha a linha entre `renderPickDisplay()` (CDB2026) e `picksTable()` (Copa,
referência visual canônica) mostrou que a estrutura de negrito já era idêntica nas duas (nome do
time em `<td>` simples, só o placar palpitado em `<b>`) — isso não era a causa. A causa real:
`renderPickDisplay()` também aplicava uma classe de linha (`pick-exact`/`pick-partial`/
`pick-miss`) que dá fundo verde/amarelo às linhas já pontuadas e `opacity: .7` às linhas erradas
— um padrão que existe no BR2026 (`.pick-group`) mas **não existe na Copa**, cujo `picksTable()`
nunca aplica classe nenhuma nas linhas (`<tr>` sempre plana, só a célula de Pts muda de cor).
Numa tela real (Playwright + estado real de produção via Supabase), linhas com `opacity: .7`
ficam visivelmente mais claras/fracas ao lado de linhas com fundo colorido e opacidade cheia —
o efeito lido como "não negrito" vs. "negrito" por quem está olhando o print, mesmo sem diferença
de `font-weight` nenhuma no código.

Corrigido — `renderPickDisplay()` não aplica mais classe de linha (`<tr>` sempre plana, igual à
Copa); a célula "Classificado" (nome do time avançando) e as linhas de bônus previsto de
campeão/vice também deixaram de usar `<b>` no nome do time — só o placar numérico fica em negrito
em toda a tabela, igual à Copa em 100%. Removidas as regras CSS `.picks-detail tr.pick-exact`/
`.pick-partial`/`.pick-miss` de `bolao/cdb2026/css/styles.css` (ficaram sem uso).
`.tie-locked-score` (v3.64, formulário de palpites — componente diferente) não foi revertido,
continua correto para o que resolvia.

**BR2026 tem o mesmo padrão de linha colorida** (`.pick-group`/`.pick-exact`/`.pick-miss` em
`bolao/br2026/js/app.js`/`css/styles.css`) — não alterado nesta tarefa (não pedido, BR2026 ainda
não publicado); registrar em `docs/bolao/CONSISTENCY_MATRIX.md` como divergência conhecida da
Copa a avaliar separadamente.

Reproduzido visualmente com o estado real de produção (Supabase, entrada "REDACTED_PARTICIPANT
#1") via Playwright antes e depois da correção — HTML da tabela confirmado sem nenhuma classe de
linha e sem `<b>` fora da coluna de placar. `node --check`: OK. `audit_scoring.py` das 3 apps
(5/5 cada), `audit_golden_master.mjs` (37/37) e `audit_integrity.py` (0 erro) re-rodados —
scoring não tocado, só marcação/CSS de exibição.

## v3.64 — 2026-08-01 — Nav Participantes/Pagamento escondidos (paridade com BR2026); nome de time em negrito consistente

Eduardo, mesma mensagem: confirmou a tabela de regras (já correta desde a v3.63, sem mudança de
código aqui — só confirmação) e pediu três ajustes de UI:

- **Nav Participantes/Pagamento escondidos**: "Deixe aparecer somente os mesmos botões que estão
  disponíveis no br2026 nesse momento agora que a competição começou." BR2026 e Copa já escondem
  esses dois botões (`style="display:none"`, ver `bolao/br2026/index.html` #106) — CDB2026 ainda
  os mostrava no nav secundário. Mesmo tratamento aplicado aqui: um `style="display:none"` por
  botão, nenhuma lógica JS tocada, as seções `#participants`/`#payment` continuam existindo e
  renderizando normalmente (só não têm mais botão de nav apontando pra elas) — mesmo padrão
  "dead nav" seguro já usado nos outros dois apps.
- **Nome de time em negrito inconsistente**: "Nos palpites alguns jogos estão em bold e outros
  não no display." Achado: `.tie-team-name` (linha de palpite ainda ABERTA, antes do cutoff da
  fase) tinha `font-weight: 700`, mas `.tie-locked-score` (linha já TRAVADA — confronto decidido
  ou fase com cutoff vencido) não tinha peso de fonte nenhum, então o mesmo tipo de informação
  (nome do time) mudava de peso visual só por causa do estado do cutoff. Corrigido —
  `.tie-locked-score` agora tem o mesmo `font-weight: 700`.
- **Regras confirmadas, sem mudança**: a tabela de pontuação e os 3 critérios de desempate já
  batiam com o que Eduardo colou (idêntico ao estado deixado pela v3.63) — nada a corrigir aqui,
  só confirmação de que está certo.

Sem e-mail enviado (Eduardo: "Esse é a regra correta, não precisa mandar novo email só ajusta
para o próximo e atualiza o ranking e o site" / "No need to send!!") — ranking e site já
refletem a fórmula certa automaticamente (`scoreEntry()` sempre calcula ao vivo a partir de
`config.js`, nunca há um total armazenado que precisasse ser recalculado à parte).

`audit_scoring.py` das 3 apps, `audit_state_merge.mjs`, `audit_golden_master.mjs`,
`audit_integrity.py --self-test`, `check_sticky_overlap.mjs` re-rodados — todos passando
(mudança só de nav/CSS, scoring não tocado).

## v3.63 — 2026-08-01 — REVERSÃO da v3.62: tier "resultado certo" restaurado (não era um bug); texto do e-mail mais claro; tiebreak Z→A removido (era só cosmético)

**A v3.62 (abaixo) estava errada.** Eduardo colou a tabela de regras completa do site e pediu
auditoria: "Sistema de pontuação ... Resultado certo (vitória/derrota/empate), placar não exato
5 ... Audite isso de acordo com o email enviado e o ranking atual." A remoção do tier `result`
na v3.62 partiu de uma comparação com a fórmula da Copa do Mundo (que só tem placar exato + gols
de um time) e concluiu, **incorretamente**, que isso era uma divergência a corrigir. Não é: o
CDB2026 sempre teve 3 tiers de pontuação por partida, documentados desde 2026-07-13 em
`CDB2026_RULES_AND_MODEL.md` §3.3 e nunca contestados por Eduardo até a v3.62 remover o tier —
"mesmos valores da Copa do Mundo" é sobre os VALORES em pontos (10/5/1), não sobre quais
categorias existem. CDB2026 e Copa do Mundo não precisam ter os mesmos tiers de pontuação.

**Revertido em todos os lugares que a v3.62 tinha alterado:**
- `js/config.js`, `js/app.js` (`matchPoints()`/`explainScore()`/`renderRules()`), `js/i18n.js` —
  restaurados a partir do commit anterior à v3.62 (`git show` do parent, não retype manual, pra
  eliminar risco de erro de transcrição).
- `scripts/audit_scoring.py`, `scripts/audit_integrity.py` — mesma restauração; ambos ganharam
  uma nota no docstring documentando os dois incidentes (a remoção errada e a reversão), sem
  reescrever silenciosamente.
- `scripts/audit_golden_master.mjs` — valores voltam a bater com o golden master original
  (`e-bravo`: 0→15 pts de novo) — mais o ajuste da remoção do tiebreak Z→A (ver abaixo).
- `docs/bolao/CDB2026_RULES_AND_MODEL.md` §3.3 — a nota de correção da v3.62 (que dizia o tier
  ter sido removido) foi por sua vez corrigida, explicando que a remoção foi revertida; a tabela
  original (nunca errada) permanece intacta.

**Texto do e-mail mais claro** (Eduardo: "Talvez precise ficar mais claro no email qual foi a
pontuação e por que pontuou"): a linha de detalhe do palpite agora diz explicitamente
"+5 resultado certo (vitória/empate/derrota) — placar não exato" em vez de só "+5 resultado
certo" — mesma mudança em `app.js`'s `explainScore()` e em `send_result_email.py`. Uma
**segunda correção foi enviada aos 12 participantes reais** deixando claro que a categoria
"resultado certo" É válida (a v3.62 tinha, por engano, dito o contrário no e-mail de correção
anterior) e mostrando a pontuação certa, mais clara, do mesmo jogo (Vasco 0–0 Fluminense).

**Tiebreak por nome (Z→A) removido — não é critério de desempate, era só cosmético** (Eduardo:
"O sort z-a não é critério de desempate favor remover, é só cosmético"): `rankEntriesBy()`
nunca usava o nome pra decidir o RANK (a chave de rank já só considera total/campeão/vice/
placares exatos) — só decidia qual entrada genuinamente empatada aparecia primeiro na lista.
Removido o comparador; `Array.sort` (estável) preserva a ordem original entre empatados agora.
Removida também a linha "4º desempate: nome da entrada Z→A" da página de Regras (`i18n.js`
`tbAlpha`, `app.js`'s `renderRules()`) — só ficam os 3 critérios reais.

`audit_scoring.py` das 3 apps, `audit_state_merge.mjs`, `audit_golden_master.mjs`,
`audit_integrity.py --self-test` re-rodados — todos passando (golden master atualizado de novo,
cada valor conferido contra o motor real via `--print` antes de editar).

## v3.62 — 2026-08-01 — Bug real de pontuação: tier "resultado certo" removido; e-mail sem versão em inglês; ordenação de "Ver palpites" corrigida

> **⚠️ REVERTIDO pela v3.63 (acima) no mesmo dia.** A remoção do tier "resultado certo" descrita
> abaixo estava errada — não era um bug, é uma regra real do CDB2026. Mantido aqui sem edição
> como registro histórico do que foi feito e por quê; ver v3.63 para a correção completa. As
> outras duas mudanças desta entrada (e-mail sem inglês, ordenação de "Ver palpites") **continuam
> válidas**, não foram revertidas.

Eduardo, ao ver o primeiro e-mail de resultado real (Vasco 0x0 Fluminense): "Isso está
incorreto!!! O resultado foi 0x0. Por que pontuou por placar exato? Verifique contra as regras
da copa do mundo. O resultado foi 0x0 verifique as regras novamente."

**Bug real confirmado — scoring, dinheiro real:** `matchPoints()` tinha um terceiro tier,
"resultado certo" (5 pts por acertar só o sinal vitória/empate/derrota, mesmo com placar
errado), que **nunca existiu** no `matchPoints()` real da Copa do Mundo (só tem placar exato +
gols de um time, dois tiers). Era uma divergência real do `CDB2026_RULES_AND_MODEL.md` (aprovado
2026-07-13) — o documento dizia "mesmos valores da Copa do Mundo" mas nunca foi checado contra o
código real da Copa. Efeito real: no primeiro jogo real (Vasco 0x0 Fluminense), 6 dos 12
participantes com palpite de empate (2x2, 1x1) receberam 5 pts cada por esse tier inexistente —
nenhum placar exato de verdade, nenhum gol de um time batendo.

**Corrigido em TODOS os lugares onde o tier existia (3 transcrições + UI):**
- `js/config.js`: `scoring.match.result` removido — só `exact: 10` e `side: 1`.
- `js/app.js`: `matchPoints()` — removido o branch de sinal (pickSign/realSign); `explainScore()`
  — removida a entrada `result` do dicionário de explicações; `renderRules()` — removida a linha
  da tabela de regras; `receiptHtml()`/`renderPickDisplay()`/`exportCsv()` — sem mudança de
  fórmula (só ordenação, ver abaixo), mas dependem do mesmo `matchPoints()` corrigido.
- `js/i18n.js`: removida a chave `rulesMatchResult`; `rulesScoreNote` atualizado.
- `scripts/audit_scoring.py`: `MATCH_SCORING` sem `result`; `match_points()` sem o branch de
  sinal; testes atualizados (`check_match_points_mutually_exclusive` agora prova que sinal-certo-
  placar-errado-sem-gol-batendo pontua 0, não 5 — o bug exato encontrado ao vivo).
- `scripts/audit_integrity.py`: mesma correção na sua própria transcrição independente — achado
  ao corrigir: o self-test deste arquivo **continuava passando com o valor antigo** porque o
  fixture golden_state.json não expunha a divergência da forma como o teste comparava (lição:
  "self-test passa" não é prova de que uma transcrição está sincronizada, só que o fixture atual
  não expõe uma divergência específica).
- `scripts/audit_golden_master.mjs`: valores esperados atualizados (`e-bravo`: 15→0 pts, muda de
  rank exclusivo 3 para empatado em rank 3 com `e-charlie`) — cada valor novo conferido contra o
  motor real extraído de `app.js` (`--print`) antes de atualizar, não "só para passar".
- `docs/bolao/CDB2026_RULES_AND_MODEL.md` §3.3: nota de correção datada adicionada, texto
  original mantido riscado como registro histórico (não reescrito).

**E-mail já enviado com o bug (Vasco 0x0 Fluminense, ida) foi corrigido** com um reenvio de
correção aos 12 participantes reais, mesmo padrão do `send_bracket_correction_email.py` da Copa.

**Não precisa versão em inglês** (Eduardo, mesma mensagem): `send_result_email.py` — removida a
metade em inglês de `build_html()` e `build_podium_html()`; e-mail agora só em português.

**Ordenação de "Ver palpites" corrigida** (Eduardo: "Ajuste a ordenação dos ver palpites, tem
que ser na ordem cronológica dos jogos. Esta em uma ordem estranha agora."):
`renderPickDisplay()` (o detalhe "Ver palpites" no Ranking), `receiptHtml()` (comprovante por
e-mail) e `exportCsv()` (exportação do admin) listavam os confrontos na ordem crua de inserção
(`Object.entries()`, ordem em que o admin/ESPN sync cadastrou cada um) em vez da ordem
cronológica de kickoff — `renderGamesSection()`/`renderPickForm()` já ordenavam corretamente por
`firstLegKickoffMs()`; as três telas que faltavam agora usam o mesmo critério.

`audit_scoring.py` das 3 apps, `audit_state_merge.mjs`, `audit_golden_master.mjs`,
`audit_integrity.py --self-test` re-rodados — todos passando (valores do golden master
atualizados deliberadamente, não "só para passar" — ver acima).

## v3.61 — 2026-08-01 — E-mail automático de resultado por partida (scripts/send_result_email.py)

Eduardo: "Cdb2026 está configurado para enviar email apos cada jogo assim como a copa? ... tem que
implementar isso! E logo já acabou o Primeiro jogo. Tem que ser EXATAMENTE igual copa do mundo!"

CDB2026 nunca teve esse recurso — só a Copa (`send_result_email.py` + workflow
`auto_results.yml`) e o BR2026 (`send_round_email.py` + `br2026_round_emails.yml`) tinham.
Implementado agora, mesma arquitetura da Copa (mesmo mecanismo EmailJS, mesmo layout bilíngue
PT/EN, mesmos gates de segurança — auto-audit antes de qualquer envio, dupla checagem de
estabilidade do resultado na ESPN com 20s de intervalo, validação de sanidade por partida antes
de confiar nela). Única diferença real é o MODELO DE DADOS: a Copa tem chaveamento fixo conhecido
de antemão; o CDB2026 é mata-mata de ida e volta com confrontos sorteados fase a fase — o script
lê os confrontos direto de `state.phases[fase].ties` e casa cada perna com a ESPN por NOME DE
TIME (mesmo mecanismo de `autoSyncEspnResults()` em `app.js`), não por bracket fixo.

- `scripts/send_result_email.py` (novo): `--auto` detecta pernas (ida/volta) da fase ativa ainda
  não salvas, salva no Supabase e envia e-mail a todos os participantes com a pontuação daquela
  perna; quando a 2ª perna de um confronto decide a classificação, o bônus de "quem avança" entra
  no mesmo e-mail (mesma técnica da Copa ao dobrar o bônus de pódio no e-mail de M103/M104).
  Quando a Final é decidida, inclui o bloco de pódio/premiação do bolão (1º/2º/3º lugar em
  dinheiro, 70/20/10% do pote) — sem 3º/4º lugar de time (a Copa do Brasil não tem disputa de 3º
  lugar). Reaproveita `audit_scoring.py` DIRETAMENTE (`match_points()`/`score_entry()`) em vez de
  reimplementar a fórmula uma segunda vez — elimina por construção o tipo de drift que o
  equivalente da Copa (uma reimplementação Python verdadeiramente independente) precisa se
  proteger contra.
- `scripts/audit_scoring.py`: adicionadas `check_match_is_real()`/`check_result_shape()`
  (mesmo par de funções da Copa), chamadas em runtime pelo `--auto` antes de confiar em cada
  resultado individual o bastante pra salvar + enviar.
- `.github/workflows/cdb2026_result_emails.yml` (novo): roda `--auto` a cada 10 min (mesma
  cadência da Copa), sem restrição de mês (a Copa do Brasil roda de agosto a novembro/dezembro,
  ao contrário da janela curta e fixa da Copa do Mundo).

**Primeiro envio real, testado e confirmado em produção no mesmo dia:** Vasco 0–0 Fluminense
(Oitavas, jogo de ida, 2026-08-01) — detectado, salvo e e-mail enviado aos 12 participantes reais
com sucesso (`--auto`, verificado leg a leg antes de rodar: detecção correta, sanidade OK,
preview do HTML renderizado e conferido antes do primeiro envio real).

`audit_scoring.py` das 3 apps, `audit_state_merge.mjs`, `audit_golden_master.mjs`,
`audit_integrity.py --self-test`, `check_cachebust.mjs` re-rodados — todos passando. Scoring,
ranking e critérios de desempate não foram tocados (o novo script só CONSOME `score_entry()`, não
o reimplementa).

## Incidente operacional — 2026-08-01 — Entrada de Matheus Ferrari salva com palpites vazios

A entrada "Matheus Ferrari" (criada 2026-08-01T20:46:17Z, `payerName: "Eduardo"`) foi salva com
`picks.matches`/`picks.qualified` vazios — nenhum palpite foi persistido, sem nenhum erro exibido
no momento do envio. Eduardo passou os 8 palpites das Oitavas manualmente por texto; salvos
diretamente no Supabase de produção nesta entrada (apenas nela — nenhum outro dado alterado).

**Nota de processo:** a primeira leitura desta mensagem por Claude tratou os dados como se fossem
os RESULTADOS OFICIAIS das Oitavas (não os palpites do Matheus) e chegou a travar as 8 fases com
`qualifiedTeamId` fictício em produção por alguns minutos — revertido integralmente antes de
qualquer outra escrita, usando uma cópia do estado lida momentos antes da escrita incorreta.
Nenhum resultado oficial de fato ficou incorreto em produção (a fase Oitavas nunca teve nenhum
resultado real travado neste dia). Registrado aqui porque é exatamente o tipo de erro que as
regras deste repositório (`CLAUDE.md`, seção de scoring) existem para prevenir — mesmo não tendo
sido um bug de código, foi um erro de leitura de instrução em uma escrita de produção de alto
risco.

**Causa raiz suspeita (não confirmada, não investigada a fundo ainda):** o horário de criação da
entrada (20:46:17Z) é ~31 min DEPOIS do cutoff calculado pra Oitavas nesse momento (kickoff
20:30Z − `cutoffOffsetMs` de 15 min = 20:15Z) — `saveEntry()` deveria ter bloqueado a criação da
entrada inteira (`isPastEntryCutoff()` checado antes de qualquer coisa), não só deixar os
palpites vazios. Hipótese mais provável: o navegador que enviou tinha uma visão local/desatualizada
do confronto (sem o kickoff ainda populado), fazendo `effectivePhaseCutoffMs()` cair pro fallback
`cutoffAt` manual (também nulo) e `isPastEntryCutoff()` retornar `false` mesmo com o prazo real já
vencido — o que também explicaria os blocos de palpite não terem renderizado campos pra
preencher (mesma falta de dado local), resultando num envio "vazio" que passa por
`validatePicks()` sem erro (que só valida blocos com classe `.tie-pick-block.open`, presentes só
quando o confronto é conhecido localmente). Não confirmado — requer investigação futura antes de
declarar corrigido.

## v3.60 — 2026-08-01 — Relógio ao vivo sem teto durante o tempo normal (period 1-3)

Achado ao vivo por Eduardo durante o intervalo real de Vasco×Fluminense (Oitavas, 2026-08-01): o
relógio do card "ao vivo" mostrou "58:11 (+14)" e continuava subindo minuto a minuto, mesmo com o
jogo genuinamente parado no intervalo.

`formatMatchClock()` já tinha um teto (`CDB_MAX_STOPPAGE_SECONDS`, 8 min) pra acréscimo — mas só
aplicado a `period === 4` (prorrogação), copiado de um bug real que a própria Copa já tinha
pegado ao vivo antes ("120:07 (+1)…" sem fim). Os períodos 1/2/3 (tempo normal) nunca tiveram
esse teto — se um poll de 60s não chegasse bem na hora em que o jogo entrava no intervalo (rede,
aba em segundo plano, ESPN engasgar), `isHalftime` ficava desatualizado e a interpolação local
somava o tempo real decorrido sem limite nenhum.

Dois fixes, ambos como defesa em profundidade (um não substitui o outro):
1. `formatMatchClock()`: teto de 8 min de acréscimo aplicado a QUALQUER período conhecido, não só
   o 4.
2. `liveClockDisplay()`: teto de 3× o intervalo de poll (180s) no tempo interpolado desde o
   último poll bem-sucedido — mesmo se o poll ficar preso por vários minutos, o relógio para de
   subir em vez de continuar somando indefinidamente.

Verificado (extração isolada de `formatMatchClock`): `formatMatchClock(58*60+11, 1, 0)` agora
retorna `"53:00 (+8)"` (teto aplicado) em vez de continuar mostrando o valor cru crescente;
comportamento do `period === 4` (já testado antes) inalterado.

**Propagado nos 3 apps** (mesmo bug, mesma correção — `bolao/copa2026/js/app.js`,
`bolao/br2026/js/app.js`, `bolao/cdb2026/js/app.js`) por exigência da regra de propagação da
plataforma. `audit_scoring.py` das 3 apps re-rodado, passando — escore/ranking/desempate não
tocados.

## v3.59 — 2026-08-01 — Fase 2.2: correção final do CTA "Salvar entrada" + evidência visual real

**Atualização:** Eduardo aprovou o deploy logo em seguida ("Approved to push") — este commit foi
para produção (`main`) no mesmo dia. O texto original desta entrada (abaixo) foi escrito antes
dessa aprovação e descrevia um estado "apenas local"; mantido como estava por ser o registro
histórico da fase, mas o status real é: **deployado**.

**Propagação (mesmo dia, após o deploy):** o mesmo defeito de overlap do CTA foi auditado nos
outros dois apps por exigência da regra de propagação da plataforma — confirmado presente em
**ambos**, incluindo na própria Copa do Mundo (`bolao/copa2026/`, referência visual canônica) e
no BR2026. Corrigido da mesma forma (fluxo normal do documento, sem `position: sticky`) em
`bolao/copa2026/css/styles.css` (v4.162) e `bolao/br2026/css/styles.css` (v1.80) — ver os
CHANGELOG de cada app para o detalhamento e a evidência (77 achados em Copa, 57 em BR2026, 0
achados após o fix em ambos).

Revisão independente da Fase 2.1 encontrou que o CTA "Salvar entrada" ainda cobria o título
`<h2>` "Nova entrada" em mobile (390×844) — o teste da Fase 2.1 só checava interseção contra
`#entry input, select, button`, nunca contra headings/texto/cards. Também confirmou que o
harness de evidência da Fase 2.1 podia salvar um screenshot com o nome da seção ERRADA quando o
clique na navegação falhava silenciosamente (exemplo real: `br2026_Palpites_390x844.png`
mostrava Ranking).

**Corrigido:**
- `.sticky-submit` (`css/styles.css`): removida toda a lógica de posicionamento flutuante
  (`position: sticky`, `pointer-events`, `text-align`, `env(safe-area-inset-bottom)`). O botão
  agora vive no fluxo normal do documento — estrutural e definitivamente impossível de sobrepor
  qualquer irmão na página, não apenas "testado e não encontrado overlap hoje".
- `scripts/visual/check_sticky_overlap.mjs`: reescrito para checar `h1-h4, p, label, small,
  span, input, select, textarea, button, a, .card, .form-group, .notice, .alert, .receipt` (não
  só controles focáveis) nos 7 viewports exigidos × 5 posições de scroll. Verificado nos dois
  sentidos: 0 achados com o fix; 60 achados (incluindo exatamente o `<h2>` "Nova entrada") ao
  reintroduzir `position: sticky` temporariamente para confirmar que o teste discrimina de verdade.
- `scripts/visual/capture_evidence.mjs`: reescrito. Nunca mais salva um screenshot sem antes
  confirmar a seção realmente ativa (`document.querySelector(".page.active")?.id`, o mesmo
  mecanismo de `showSection()`) — se não bate com a seção pedida, o registro vai para o manifest
  como `status: "failed"` e nenhum arquivo é gravado. Fixtures sintéticas (nomes fictícios, sem
  PII) aplicadas via `localStorage` + reload. Chamadas a Supabase/ESPN/EmailJS respondidas com
  `route.fulfill()` (JSON vazio válido) em vez de `.abort()` — o app já trata "sem dados" como
  caso normal, então não há mais erro de rede a filtrar por texto. Screenshots antigos (com nomes
  de seção incorretos, herdados da Fase 2.1) removidos antes de recapturar.
- `scripts/visual/playwright_loader.mjs` (novo): resolução portável do Playwright —
  `import("playwright")` primeiro, depois `PLAYWRIGHT_PATH`, com fallback documentado só para
  este sandbox.
- `scripts/visual/check_manifest.mjs` (novo): valida `docs/bolao/evidence/visual/manifest.json`
  — falha se `captured=true` com seção errada, screenshot ausente, erro de console/página não
  classificado, `horizontalOverflow=true`, ou `overlaps` não vazio.

**Bug real adicional encontrado e corrigido durante esta fase (fora do escopo original, mas não
poderia ser ignorado por instrução permanente do projeto):** `context.addInitScript()` — a forma
padrão de semear `localStorage` antes da navegação no Playwright — está silenciosamente quebrada
neste sandbox: um valor gravado por um init script nunca sobrevive à navegação (confirmado com um
repro isolado, chave trivial, página estática qualquer), provavelmente por incompatibilidade de
versão entre o driver Playwright (1.56.1) fixado no ambiente e o binário Chromium (141.0.7390.37)
também fixado nele. Como consequência, TODAS as fixtures sintéticas da Fase 2.1
(`check_sticky_overlap.mjs` e a primeira versão desta reescrita de `capture_evidence.mjs`) nunca
foram de fato aplicadas — as capturas rodavam sobre o estado vazio/default do app, não sobre a
fixture pretendida. Corrigido em ambos os scripts trocando `addInitScript()` por
`page.evaluate()` (grava o `localStorage` depois do primeiro load) seguido de `page.reload()` —
confirmado funcionando (Ranking do CDB2026 agora mostra as duas entradas fictícias e o pote
correto, `$5`, em vez de "Nenhuma entrada ainda"). Isso não afetou a validade do teste de overlap
em si (que não depende de conteúdo de `entries`, só da posição do CTA), mas SIGNIFICA que a
evidência visual da Fase 2.1 (84 screenshots) não era comparável/representativa como alegado —
capturava o app vazio, não o estado sintético descrito na documentação daquela fase.

**Limitação de evidência conhecida (não é bug do app):** screenshots `fullPage` de páginas com
`.topbar { position: sticky }` mostram uma faixa duplicada/fantasma do cabeçalho no topo — artefato
confirmado da técnica de montagem (stitching) de screenshots em página inteira do Playwright
quando há elementos sticky, não um problema de renderização real (a página ao vivo renderiza
corretamente; só a captura automatizada tem esse artefato). Registrado aqui para não ser
confundido com uma regressão visual real.

**Validado nesta fase (sem alteração):** `audit_scoring.py` das 3 apps, `audit_state_merge.mjs`,
`audit_golden_master.mjs`, `audit_integrity.py --self-test`, `check_cachebust.mjs` (regenerado
após a mudança de CSS) — todos passando. Escore, ranking, critérios de desempate, mutações
administrativas, confrontos, cutoffs e Supabase/ESPN/EmailJS não foram tocados nesta fase.

**Não aplicado nesta fase (trabalho restante, não bloqueante para o fix do CTA):** comparação
visual formal ponto-a-ponto contra a Copa (tipografia/cards/modais/toasts), validação completa de
navegação (foco/hover/teclado) nos 3 apps, atualização dos 4 documentos de plataforma
(MODERNIZATION_REPORT, TRACEABILITY_MATRIX, OPERATIONS_RUNBOOK, RISK_CONTROL_MATRIX) e empacotamento
final (ZIP/bundle/hashes). Ver mensagem de entrega ao Eduardo para o detalhamento completo.

Nenhum push, deploy, ou escrita em produção nesta fase — apenas commits locais, por instrução
explícita do Eduardo.

## v3.58 — 2026-08-01 — Merge da Fase 2.1 em produção + 2 bugs reais corrigidos ao vivo

Eduardo aprovou a Fase 2.1 (mutação administrativa dirigida, paridade visual, cache-bust,
fixtures, docs — ver `v3.57` abaixo) para produção durante o jogo real Vasco×Fluminense (Oitavas,
2026-08-01). Esta branch precisou primeiro incorporar o hotfix de emergência que já estava em
produção (`v3.55` abaixo, cutoff reaberto + fix do merge de `cutoffOffsetMs`) antes de poder ir
ao ar, para não regredir essa reabertura ao mesclar.

Dois bugs reais adicionais, encontrados pelo Eduardo olhando o jogo ao vivo:

**Jogo ao vivo com ranking parcial não aparecia.** A ESPN nomeia o time como "Vasco da Gama"; o
confronto curado em `data.js`/criado pela sincronização usa "Vasco". Todo casamento por nome
exato (`fetchLiveTies()`, `autoSyncEspn()`, `autoSyncEspnResults()`) falhava silenciosamente para
esse time — o card ao vivo nunca aparecia, e o resultado final também nunca teria sido travado
automaticamente. Verificado contra o endpoint real da ESPN: única divergência de nome entre os 8
confrontos das Oitavas. Corrigido com o mesmo padrão que o BR2026 já usa
(`ESPN_SCOREBOARD_NAME_ALIASES`/`normalizeEspnTeamName`) — `CDB_ESPN_NAME_ALIASES` aplicado onde
`fetchEspnCandidates()` monta `homeTeam`/`awayTeam`.

**Botão "Palpites" continuava habilitado depois do prazo passar de verdade.** O estado
`disabled` do botão só era avaliado uma vez, logo após o carregamento da página. Uma sessão
aberta desde antes do cutoff continuava mostrando o botão habilitado muito depois do prazo real
ter passado, até um F5. Corrigido: reavaliado a cada 1s, no mesmo timer que já atualiza o
countdown.

## v3.57 — 2026-08 — Fase 2.1: correções bloqueadoras e paridade visual profissional

Revisão independente da Fase 2 confirmou 6 bloqueadores reais. Relatório completo:
`docs/bolao/CDB2026_MODERNIZATION_REPORT_2026-08.md` (seção "Fase 2.1").

**Mutação administrativa dirigida (bloqueador #1/#2).** O read-merge-write da v3.55 protege
resultado oficial contra cache de participante, mas a mesma regra aplicada a uma ação do próprio
admin impedia `paid: true -> false`, destravar confronto, limpar placar, etc. Novo
`applyAdminMutation()`/`applyMutationOverRemote()`: toda ação administrativa (12 tipos — cutoff,
add/remove tie, save/clear leg, lock/unlock tie, pagamento, exclusão de entrada, fase ESPN ativa,
mais os equivalentes automáticos de sincronização ESPN) declara explicitamente qual mudança está
fazendo, aplicada sobre o remoto mais recente, preservando qualquer alteração remota não
relacionada. 15 call sites religados. 11 novos testes de mutação + preservação de alteração
remota independente + batch ESPN em `audit_state_merge.mjs`.

**Concorrência reclassificada em 3 categorias** (não 2): sequencial — mitigado; mutação explícita
— corrigida; gravação simultânea real — limitação arquitetural restante, documentada, não
resolvida (ver `docs/bolao/adr/ADR-002-state-merge-strategy.md`).

**Cache-bust (bloqueador #3).** `?v=58d393d` era anterior a toda a Fase 1/2/2.1. Tag agora é
derivada do conteúdo (SHA-256 dos 5 arquivos críticos), não escolhida à mão — impossível ficar
desatualizada sem que o hash também mude. Novo `scripts/check_cachebust.mjs` (`--write` para
regenerar) falha se a tag não bater com o conteúdo atual.

**Paridade visual (bloqueador #4, P1).** Topbar: 8 abas primárias → 6
(`Palpites/Ranking/Jogos/Probabilidades/Regras/Admin`), igual à densidade do BR2026;
`Participantes`/`Pagamento` continuam acessíveis por um link secundário compacto, nenhuma
funcionalidade removida. Botão sticky: adotado o padrão canônico exato da Copa
(`pointer-events`/`text-align`) + `env(safe-area-inset-bottom)` + reserva de espaço no fluxo —
zero overlap confirmado nos dois estados de repouso reais (carga inicial e fim de scroll) nas 4
larguras exigidas; overlap transitório durante o gesto de scroll ativo documentado como limitação
inerente ao padrão sticky (não bloqueia toque, `pointer-events: none` no wrapper), não escondida.

**Evidência visual durável (bloqueador #5).** Novo `scripts/visual/capture_evidence.mjs` — harness
Playwright real, rede externa bloqueada, sem dados reais. 84 screenshots (3 apps × 7 viewports),
manifesto JSON, relatório de overflow (0 achados) e de erros de console (0 achados reais) em
`docs/bolao/evidence/visual/`.

**Documentação (bloqueador #6).** `CONSISTENCY_MATRIX.md`: 3 afirmações erradas corrigidas
(`database.enabled`, estratégia de merge, "sem API externa"). PII removida de 5 arquivos (nome
real de participante → "Participante A/B/C"). 4 requisitos novos na matriz de rastreabilidade.

**Fixtures de integridade.** `golden_state.json` roda sem nenhum WARNING/ERROR/CRITICAL — o único
caso problemático (FINAL 0x0 com kickoff futuro) virou fixture negativa dedicada. 3 fixtures
negativas novas, cada uma provada a disparar o finding certo via `audit_integrity.py --self-test`.

**Regressão:** todos os suites anteriores continuam passando (`audit_scoring.py` ×3,
`audit_state_merge.mjs`, `audit_golden_master.mjs`, `audit_integrity.py --self-test`,
`check_sticky_overlap.mjs`, `check_cachebust.mjs`). Nenhuma área crítica (scoring, ranking,
desempate, resultados, pagamentos, dados históricos) alterada.

## v3.56 — 2026-08 — Fase 2: modernização controlada, limpeza técnica, preparação para auditoria

Continuação da auditoria de código (v3.55) pedida pelo Eduardo — desta vez modernização
controlada em cima de um golden master fixado antes de qualquer mudança (hash de comportamento
verificado **inalterado** do início ao fim). Relatório completo:
`docs/bolao/CDB2026_MODERNIZATION_REPORT_2026-08.md`. Novos documentos de plataforma:
`CDB2026_CODE_INVENTORY.md`, `CDB2026_DATA_DICTIONARY.md`,
`CDB2026_REQUIREMENTS_TRACEABILITY_MATRIX.md`, `CDB2026_DATA_LINEAGE.md`,
`CDB2026_RISK_CONTROL_MATRIX.md`, `CDB2026_DEPENDENCY_INVENTORY.md`,
`CDB2026_BACKUP_AND_RECOVERY.md`, `CDB2026_OPERATIONS_RUNBOOK.md`, `docs/bolao/adr/ADR-001..005`.

**Explicabilidade de pontuação (`explainScore()`).** Nova função que decompõe o total de uma
entrada item a item, derivada exclusivamente do `detail` que `scoreEntry()` já devolve — nunca
recalcula. Reconcilia exatamente com o total oficial nas 4 entradas de teste, inclusive uma
entrada sem nenhum palpite (zero linhas, sem fabricar dado). Exposta via
`window.__CDB2026_TESTHOOKS__`.

**Auditor de integridade somente-leitura (`audit_integrity.py`, novo).** Detecta IDs/entradas
duplicadas, entrada sem participante, pagamento sem entrada, resultado sem confronto, partida
FINAL sem placar, campeão incompatível com o placar da Final, timestamps inválidos, flags de
migração inválidas, eventos de audit log malformados, referências quebradas. Trabalha por padrão
só com a fixture anonimizada; nunca acessa produção. Self-teste próprio recomputa a pontuação da
fixture com a mesma fórmula transcrita em `audit_scoring.py` e se recusa a rodar se divergir do
golden master (achado durante a escrita: a primeira versão do recompute esquecia o bônus de
vice-campeão — pego pelo próprio self-teste antes de qualquer uso real, nunca chegou a produção).

**Consolidação de duplicidade (baixo risco, comportamento idêntico, verificado pelo golden
master antes/depois):** timestamp BRT (4 sites → `formatBrtTimestamp()`); cache de relógio ao
vivo (2 pares → `safeLocalStorageGetJson`/`safeLocalStorageSetJson`); scaffolding de
fetch+timeout duplicado em 2 chamadas ESPN (consolidado sobre `fetchJson()`, já existente);
markup do QR do Zelle (2 sites → `zelleQrHtml()`). Achados de maior risco (travessia de picks
triplicada em recibo/ranking/CSV; 4 sites de escrita direta de `localStorage` do estado
principal) foram deliberadamente **não** consolidados — a regra em cada site só é
*aparentemente* igual, não é seguro fundir sem uma reformulação maior.

**Código morto removido (evidência verificada individualmente, ver relatório):** variável
`_liveTiesLastPollAt` (nunca lida); 7 regras CSS sem nenhuma referência estática ou dinâmica
(`.cdb-results-grid`, `.pick-group-note`, `.pick-pos-label`, `.pick-select`, `.tie-advance`,
`.tie-vs`, `.tie-teams-pending`). Campos de config aparentemente não-lidos
(`provider`/`leagueSlug`/`localFallback`) **não** foram removidos — são um padrão compartilhado
com BR2026/Copa, fora do escopo de um patch de um app só.

**Timezone do audit log inconsistente (achado, não corrigido).** Recibo/rodapé/CSV/cutoff usam
BRT; o audit log admin usa ET, sem justificativa documentada — mudar isso muda o horário civil
mostrado, não é só formatação, então ficou registrado para decisão do Eduardo em vez de alterado
silenciosamente.

**Mensagem de confirmação de e-mail corrigida (era otimista demais).** "Verifique seu e-mail
para o comprovante" prometia entrega antes do envio de fato acontecer (a fila é em memória, sem
retry, sem persistência entre reloads). Agora aponta para o comprovante em-página, que É síncrono
e sempre disponível: "O comprovante também fica disponível aqui na página — o envio por e-mail
pode levar alguns instantes."

**Concorrência real (caracterizada, não implementada).** Novo teste em `audit_state_merge.mjs`
prova que o read-merge-write (v3.55/AUDIT-03) resolve staleness sequencial mas NÃO uma corrida
verdadeira entre duas escritas quase simultâneas — classificação formal e recomendação
arquitetural em `docs/bolao/adr/ADR-002-state-merge-strategy.md`. Nenhum backend novo
implementado (fora de escopo, mudança de arquitetura).

**`paid` any-true-wins (reavaliado).** Evita reversão acidental, mas também impede correção
legítima de um pagamento marcado errado — modelo futuro com `reason`/`updatedBy`/`operationId`
proposto em `CDB2026_MODERNIZATION_REPORT_2026-08.md` §5, não implementado (muda o formato do
dado, exige decisão do Eduardo).

**Regressão:** `python3 bolao/cdb2026/scripts/audit_scoring.py`, `python3
bolao/br2026/scripts/audit_scoring.py`, `python3 bolao/copa2026/scripts/audit_scoring.py`, `node
bolao/cdb2026/scripts/audit_state_merge.mjs`, `node
bolao/cdb2026/scripts/audit_golden_master.mjs`, `python3
bolao/cdb2026/scripts/audit_integrity.py` — todos passando. QA de navegador real (Playwright,
Supabase/ESPN/EmailJS/CDN bloqueados) nas 4 rotas do bolão, desktop e mobile — sem erro real de
console.

## v3.55 — 2026-08 — Auditoria de código: 1 P0 + 4 P1 + 3 P2 corrigidos

Auditoria técnica completa pedida pelo Eduardo (relatório integral em
`docs/bolao/CDB2026_CODE_AUDIT_2026-08.md`, com evidência e reprodução de cada item). Todos os
problemas foram **reproduzidos antes de corrigir**. A pontuação oficial estava **correta** e não
foi tocada — os achados se concentraram em persistência concorrente e nos documentos que provam
o que o participante apostou.

**P0 — perda de dados por gravação concorrente (AUDIT-03).** `saveRemoteState()` gravava a coluna
`state` inteira com o snapshot local de quem salvou (`Prefer: resolution=merge-duplicates` resolve
conflito de LINHA no upsert, não mescla o JSON), sem reler o remoto antes. Reproduzido contra a
função real: um participante com cache anterior salvando sua entrada **revertia** a marcação de
pagamento feita pelo admin e **apagava** a entrada de outro participante. Agora faz
read-merge-write via `mergeStates()`; se a pré-leitura falhar (offline), grava o snapshot local
mesmo assim (nunca perder a entrada) e registra o aviso.

**P1 — flags de migração descartadas (AUDIT-01).** `mergeStates()` reconstruía `espnSync` com
apenas 2 dos 5 flags; os outros 3 sumiam em todo sync remoto, fazendo rotinas "roda uma vez"
rodarem de novo a cada carga — inclusive `healPhantomTies()`, que **apaga** ties fora da lista
curada (um confronto criado à mão pelo admin, ainda sem palpites, era removido silenciosamente).
Agora há lista explícita `ESPN_SYNC_ONCE_FLAGS` com merge OR.

**P1 — `paid` sobrescrito por cache velho (AUDIT-02).** O merge usava spread (local sempre vence),
então um `false` local antigo apagava um `true` remoto do admin — apesar de o `PROJECT_MEMORY.md`
já descrever este merge como any-true-wins e a Copa já implementar assim. Corrigido para OR por
chave, com união das chaves dos dois lados.

**P1 — falha de gravação tratada como sucesso (AUDIT-04).** `await fetch()` não rejeita em 4xx/5xx
e não havia checagem de `response.ok`; o call site tinha `.catch(() => {})` vazio. Um 403 de RLS
resultava em toast de sucesso normal com o dado só no navegador. Agora lança em `!r.ok` e mostra
o novo toast `syncFailed`, que separa "salvo neste dispositivo" de "sincronizado".

**P1 — placar da VOLTA invertido no comprovante, no ranking e no CSV (AUDIT-05).** Essas três
superfícies imprimiam `teamA × teamB` fixo, enquanto `goalsHome/goalsAway` são relativos ao
mandante real da perna (na volta, `teamB`). Um palpite "Fluminense 3 × 0 Vasco" aparecia como
"Vasco 3 × 0 Fluminense". **Não afetava pontuação** (`matchPoints()` compara na mesma orientação),
mas invertia justamente os documentos que provam a aposta. Nova função única
`legTeams(tie, leg, match)` usada nas três.

**P1 (latente) — jogo adiado virando FINAL 0-0 (AUDIT-06).** O flag `postponed` era calculado mas
não consultado no caminho de ESCRITA: `homeScore`/`awayScore`/`homeWinner`/`awayWinner` só
checavam `state === "post"`, e a ESPN reporta jogo adiado como `post` **com `score:"0"`**. Gravaria
um FINAL 0-0 de jogo nunca disputado — e o placar falso **bloquearia para sempre** o resultado real
(`if (m.goalsHome != null) return`). Sem exposição hoje (0 jogos adiados na Copa do Brasil,
verificado na API real), mas corrigido com `&& !postponed`.

**P2 — comprovante prometido e não enviado (AUDIT-07).** `_lastEmailTs` é global, não por
participante: a 2ª entrada salva em menos de 30s (mesmo de outra pessoa) tinha o e-mail
**descartado em silêncio**, enquanto o toast dizia "Verifique seu e-mail". Agora há fila serial
(`queueReceipt()`) que **espera** a janela em vez de descartar — o rate limit continua existindo.

**P2 — ações de dinheiro sem audit log (AUDIT-08).** Marcação de pagamento e exclusão de entrada
não deixavam rastro. Agora registram antes/depois.

**P2 — fuso implícito no comprovante (AUDIT-09).** Único `toLocaleString("pt-BR")` sem `timeZone`;
agora `America/Sao_Paulo` + sufixo `(BRT)`, alinhado ao CSV. Nenhuma data histórica alterada.

**Novo:** `bolao/cdb2026/scripts/audit_state_merge.mjs` — 21 checagens de merge/persistência/
orientação, sem dependências, que **extraem as funções reais** de `app.js` (não uma transcrição à
mão). Validado que falha contra o código pré-correção e passa depois.

Não corrigidos de propósito (decisão do proprietário): privacidade da página de participantes e
política de exclusão de entrada. Limitação arquitetural registrada: autorização de admin real
exige backend.

`audit_scoring.py`: 5/5 no CDB2026, 5/5 no BR2026, 6/6 na Copa — nenhum tocado. Nenhum arquivo de
BR2026 ou Copa do Mundo modificado.

> **Nota sobre numeração de versão:** a entrada abaixo (também "v3.55") foi deployada direto em
> produção, num hotfix de emergência feito numa branch separada, antes desta branch (Fase 1/2/2.1)
> ser mesclada de volta em `main`. As duas linhas de desenvolvimento chegaram em v3.55
> independentemente. Mantidas as duas entradas, sem renumerar retroativamente — a ordem
> cronológica real de deploy em produção foi: v3.54 → v3.55 (hotfix, abaixo) → v3.56/v3.57/v3.58
> (esta branch, mesclada depois).

## v3.55 — 2026-08-01 — EMERGENCY_HOTFIX: reabrir entrada das Oitavas até 15min antes do 1º jogo

Eduardo, ~20 min antes do 1º jogo da Oitavas (Fluminense × Vasco, 17:30 BRT): "abra o site da
copa do brasil para entrar palpites por mais 15 minutos, deixe aberto até 15 minutos antes do
primeiro jogo comecar". O cutoff automático (1h antes do 1º kickoff conhecido da fase) já tinha
fechado a entrada ~7 minutos antes deste pedido.

Em vez de mexer na fórmula de `effectivePhaseCutoffMs()` para todo mundo (o comentário do
próprio código já registra que essa função foi causa raiz de pelo menos 3 incidentes de produção
em 2026-07-14 quando mexida sem cuidado — v3.18, também EMERGENCY_HOTFIX), a janela virou
configurável por fase (`s.phases[id].cutoffOffsetMs`, opcional), com default 3600000 (1h) —
**comportamento idêntico ao de sempre em toda fase que não define o campo**. Só
`s.phases.oitavas.cutoffOffsetMs = 900000` foi setado, direto no estado de produção (Supabase),
escopado exclusivamente à fase Oitavas de hoje — Quartas/Semifinal/Final continuam em 1h sem
nenhuma mudança de código adicional quando chegar a vez delas.

Autoexpira sozinho: não há necessidade de reverter nada às 20:15 UTC (15min antes do jogo) — a
mesma fórmula (`kickoff - offsetMs`) volta a bloquear entrada sozinha assim que o horário passar,
exatamente como pedido.

Verificado (extração da função real, não uma cópia): comportamento padrão inalterado quando o
campo está ausente; override produz exatamente `kickoff - 15min`; outras fases não afetadas pelo
override da Oitavas. `node --check` em todos os `.js` de `bolao/`, `audit_scoring.py` passando.

## v3.54 — 2026-07-26 — Postponed-leg detection never actually matched (same bug as BR2026)

Same root cause and fix as `bolao/br2026/CHANGELOG.md` v1.78, found auditing BR2026's live
standings after Eduardo reported table data looking wrong there. CDB2026's `postponed` flag
(added 2026-07-15, explicitly ported from BR2026's `fetchSchedule()`) compared ESPN's status
constant against `"POSTPONED"`/`"CANCELED"` — but the real value is `"STATUS_POSTPONED"`/
`"STATUS_CANCELED"`, so the comparison never matched and the flag was always `false`. Used by
`isLegPostponed()` to gate the "Adiado" chip and to exclude postponed legs from the live-tie
poll (`fetchLiveTies()`).

Fixed to `state === "post" && completed === false` — the reliable signal, matching BR2026's fix.

`audit_scoring.py` — 5/5, unaffected.

## v3.53 — 2026-07-25 — Live-tie poll not reliably re-triggered after backgrounding the tab

Same root cause and fix as `bolao/br2026/CHANGELOG.md` v1.74 (found auditing BR2026's identical
gap after Eduardo reported stale live scores/clock there). CDB2026's `pollLiveTies()` uses a
plain 60s `setInterval` rather than BR2026's self-rescheduling chain, but shared the same
underlying gap: `focus`/`pageshow`/`visibilitychange` only resynced Supabase (`debouncedReload()`),
never re-triggered `pollLiveTies()` on resume. No CDB2026 match is live today so this couldn't
have been directly observed yet, but it's the identical platform-wide pattern — Copa already
solves it via `startLiveScorePolling()` on the same three events.

**Fix**: added unconditional `focus`/`pageshow`/`visibilitychange` listeners that call
`pollLiveTies()` immediately (outside the `if (C.database.enabled)` block, since live ESPN
polling doesn't depend on Supabase). Verified locally: before the fix, a simulated bfcache-restore
`pageshow` event triggered zero new ESPN requests; after, it triggers one immediately.

`audit_scoring.py` — 5/5, unaffected (poll-scheduling/event-listener change only, no scoring
logic touched).



Platform-wide fix (see `bolao/copa2026/CHANGELOG.md` v4.161 for the full root-cause writeup —
found while answering Eduardo's "fixed for everything that exists now and the future?" after the
BR2026 round-email subject fix). Added `emailSubjectSafe()` next to `receiptCode()` in `app.js`
and applied it to `entry_name` in both the participant confirmation email and the admin "Nova
entrada" notification — CDB2026 never had a round-email feature, so this app's only exposure was
free-typed entry names. `audit_scoring.py` — 5/5, unaffected. `node --check` clean.

## v3.51 — 2026-07-19

### Changed — switcher's "Copa do Mundo" option now points at bolao/copa2026/

Copa 2026 moved from `bolao/` to `bolao/copa2026/` this same day — see `bolao/copa2026/CHANGELOG.md`
v4.159. Updated this app's own "Alternar bolão" switcher option value and the `allowed` array in
its change handler so selecting "Copa do Mundo" here lands on the new location instead of the
now-redirecting `/bolao/` (which would otherwise bounce back here — an infinite loop).

`audit_scoring.py`: PASSED, unchanged — one link value updated, no app logic touched.

## v3.50 — 2026-07-19

### Fixed — substituições nunca apareciam nos lances ao vivo (mesmo bug da Copa, propagado no mesmo dia)

Achado real na Copa durante a Final ao vivo (Eduardo: "As substituições sumiram do lugar onde tem
os lances cartões e gols") — o endpoint de scoreboard da ESPN (`comp.details`, usado por
`extractMatchPlays()`) nunca inclui eventos de substituição, só gols e cartões. O CDB2026 tinha
exatamente o mesmo padrão de código (porta direta da Copa/BR2026, `comp.details`-only,
`fetchEspnCandidates()`) — mesmo bug.

Correção idêntica à da Copa/BR2026: novo `fetchEspnEventSummary(eventId)` busca o endpoint de
summary por evento da ESPN (mesma liga `bra.copa_do_brazil` do scoreboard, URL derivada de
`C.espn.scoreboardUrl`), que tem um `keyEvents` mais completo incluindo substituições — só chamado
para confrontos ao vivo no momento. `extractMatchPlays(comp, keyEvents)` prefere essa fonte quando
disponível, com fallback para `comp.details` se a busca extra falhar. Verificado que o endpoint de
summary responde corretamente para a liga `bra.copa_do_brazil` com dado real da ESPN.

`audit_scoring.py`: PASSOU, sem alteração — mudança somente de apresentação, nenhuma
pontuação/regra tocada.

## 2026-07-19 — Publicado (sem bump de versão — mudança de documentação, não de código)

Eduardo pediu para convidar todos os participantes do bolão por e-mail, já que o BR2026 fechou
entradas em 16/07. Confirmado que o CDB2026 estava pronto para abrir de verdade: Supabase e
EmailJS habilitados, pagamento configurado, 3 entradas reais já existentes, fase 5 (oitavas de
final) já com resultados reais, próxima fase (Rodada de 16) com jogos reais agendados a partir de
01/08/2026. Removida a marcação "não publicado" de `CLAUDE.md` e da documentação da plataforma
(ver `docs/bolao/CONSISTENCY_MATRIX.md`, nota de 2026-07-19). Nenhum código do app mudou — o app
já estava tecnicamente acessível via `bolao-switcher`; "publicar" aqui é o anúncio oficial aos
participantes por e-mail, não uma alteração técnica. Sem link no site pessoal principal — só
divulgação por e-mail/grupo.

## v3.49 — 2026-07-17

### Changed — local do jogo removido do card ao vivo

Mesmo pedido da Copa/BR2026 (ver changelog de cada um) — Eduardo: "Não precisa mostrar a
localização no live mode." Removido o local (📍) de `renderLiveTieCard()`; a fase (ex. "Oitavas
de Final") continua. Local continua aparecendo normalmente no card "Próximos jogos" (pré-live).

`audit_scoring.py`: PASSOU. Presentation-only.

## v3.48 — 2026-07-17

### Changed — "Ranking ao vivo" agora aparece sempre que há confronto ao vivo

Mesmo achado/decisão do BR2026 (ver changelog dele) — removida a condição `hasMover` de
`renderLiveRankingHero()`, que escondia o hero inteiro sempre que ninguém ainda tinha subido ou
descido de posição. Propagado aqui mesmo sem tie ao vivo pra testar agora (Oitavas só começa
1º/ago) — mesmo padrão de código, mesma decisão de produto.

`audit_scoring.py`: PASSOU. Presentation-only.

## v3.47 — 2026-07-17

### Changed — horário do jogo agora mostra EST/EDT e BRT juntos (EST primeiro)

Mesmo achado da Copa/BR2026 (ver changelog de cada um) — `fmtDate()` (função central,
compartilhada entre a aba "Jogos" e o card "Próxima partida") agora prefixa o horário BRT com
`estTimeStr()` (mesmo helper do BR2026, `Intl`/`America/New_York`). Como `fmtDate()` é a única
função usada nos três lugares que mostram horário de confronto, a mudança propaga automaticamente
para todos eles sem precisar editar cada um. Formato: `"16:30 (EDT) · sáb., 01/08, 17:30 BRT"`.

`audit_scoring.py`: PASSOU. Presentation-only.

## v3.46 — 2026-07-17

### Fixed — faltava a fase (Oitavas/Quartas/...) no card de próximo confronto, e fase+venue no card ao vivo

Mesmo achado da Copa (ver changelog dela, "Falta a localização do jogo e qual rodada estamos") —
`renderNextTieCard()` já mostrava venue no card de 1 confronto só, mas nunca mostrava a FASE
(`DATA.phases[].name`, ex. "Oitavas de Final") em nenhum dos dois formatos (card rico ou lista
compacta), e a lista compacta também não mostrava venue. `renderLiveTieCard()` não mostrava nem
fase nem venue.

Corrigido: `findAllUpcomingMatchesOnNextDay()` agora carrega `phase.name` junto com cada jogo;
`renderNextTieCard()` mostra a fase (e venue, na lista compacta) em ambos os formatos.
`renderLiveTieCard()` ganhou um novo bloco `.live-match-meta` com fase (via `getPhaseDef()`) +
venue (lido de `l.tie.matches[l.leg]`).

CDB2026 não precisa mostrar setas de posição de time no card ao vivo (mata-mata, não tem
"posição na tabela" — só o ranking de participantes tem movimento, já implementado antes) —
mantido como está, `TOURNAMENT_SPECIFIC`.

Verificado com o estado real de produção (Supabase) — Oitavas de Final (Vasco × Fluminense,
Atlético-MG × Juventude, Santos × Remo) mostram fase + venue corretamente na lista de próximos
jogos.

`audit_scoring.py`: PASSOU. Presentation-only.

## v3.45 — 2026-07-17

### Changed — "Próximos jogos": contador em texto trocado pelo widget de dígitos da Copa

Mesmo achado do BR2026 (ver changelog dele) — trocado o resumo em texto por
`countdownTimerHtml()`, o mesmo widget de caixas em dígitos já usado no card de 1 partida só.

## v3.44 — 2026-07-17

### Fixed — "Próximos jogos"/"Próxima partida": rótulo cinza (devia ser verde) + centralização revertida

Mesmo achado do BR2026 (ver changelog dele pro detalhe completo) — rótulo corrigido pra verde
(`.hero-next-label` da Copa) e a lista de múltiplas partidas revertida de centralizada pra
alinhada à esquerda, igual ao card de referência real da Copa.

## v3.43 — 2026-07-17

### Fixed — "Próximos jogos" (múltiplas partidas no dia) sem contagem regressiva, alinhado à esquerda

Mesmo achado do BR2026 (ver changelog dele) — a lista compacta de múltiplas partidas no mesmo
dia não mostrava contagem regressiva nenhuma (só data/hora fixa), e ficava alinhada à esquerda.
Agora mostra "· em Xh Ym" / "· Xm Ys" igual ao BR2026, e está centralizada.

## v3.42 — 2026-07-17

### Fixed — vão em branco no final da página no iOS (hipótese: reflow de rolagem do WebKit)

Mesmo achado/mecanismo do BR2026 (ver changelog dele pro detalhe completo) — cards que
aparecem/somem dinamicamente a cada poll de 60s (ao vivo, ranking ao vivo, próxima partida,
contagem regressiva) podem encolher o conteúdo enquanto a página está rolada perto do final,
deixando um vão vazio no Safari do iOS. `nudgeScrollReflow()` aplicada depois de cada ciclo de
renderização (`pollLiveTies()` e `renderAll()`).

## v3.41 — 2026-07-17

### Fixed — caixa de foco feia ao redor do título ao trocar de aba

Mesmo achado do BR2026 (Eduardo, screenshot) — `showSection()` foca o `<h2>`/`<h3>` da seção a
cada troca de aba (pra leitor de tela), o anel de foco padrão do navegador ficava visível como
uma caixa. Escondido, mesmo ajuste na Copa e no BR2026.

### Fixed — caixa da contagem regressiva ficava vazia e visível depois do prazo da fase encerrar

Mesmo achado do BR2026 (Eduardo: "Pode esconder isso") — a caixa "Encerrado" continuava ocupando
o mesmo espaço grande da contagem regressiva. Corrigido pra esconder a caixa inteira quando o
prazo da fase ativa passa, mesmo padrão da Copa/BR2026 — reaparece sozinha quando o admin avança
pra uma fase com prazo futuro (não é "fim do torneio", é "fim do prazo da fase atual").

### Fixed — pontos do Ranking quebrando em duas linhas ("170" / "pts")

Mesmo achado do BR2026 (Eduardo: "Deixe tudo da entrada em uma linha e sem crlf") — removido o
sufixo " pts" do Ranking, mesmo padrão da Copa (número puro, sem rótulo, cabe na coluna de
largura fixa de 40px no mobile).

## v3.40 — 2026-07-16

### Fixed — card "ao vivo" trazido pro mesmo padrão da Copa/BR2026 (estava na pilha vertical antiga)

Eduardo, depois de ver o card "ao vivo" do BR2026 refeito: "aplicou as mesmas alteracoes na
CDB2026? PRECISAMOS SER CONSISTENTES!" Achado real de consistência (não só um pedido): o
`renderLiveTieCard()` daqui usava a MESMA pilha vertical que o BR2026 tinha antes de ser
corrigida (badge, times, placar, relógio cada um numa linha própria) — nunca tinha sido
atualizado pra estrutura horizontal real da Copa (`hero-live-card`). Refeito copiando a mesma
estrutura/tokens já portados pro BR2026 (`.live-top/.live-team/.live-score/.live-center`), com
múltiplos jogos ao vivo lado a lado (`.live-match-grid`) em vez de empilhados. Sem badge de
posição de tabela (Copa do Brasil é mata-mata, sem classificação de liga) e sem barras de
probabilidade ao vivo (sem modelo in-play aqui ainda — lacuna registrada, não decisão
definitiva, em `docs/bolao/CONSISTENCY_MATRIX.md`).

### Added — minuto a minuto de gols/cartões/substituições no card "ao vivo"

Mesma paridade — portado quase literalmente do BR2026 (`extractMatchPlays`/`livePlaysHtml`),
mesmo `comp.details` já buscado a cada poll do card ao vivo, sem chamada de rede extra.

### Added — Ranking reage ao placar ao vivo + hero "Ranking ao vivo"

Eduardo, sobre posição de time vs. participante: "CDB no need to show up and down for the teams
as it is knock out, but up and down for the user ranking, yes." Confirmado: sem classificação de
liga na Copa do Brasil, não faz sentido posição de TIME — mas o Ranking de PARTICIPANTES agora
reage ao placar ao vivo em tempo real. Nova `liveScoreEntry()` soma os pontos de partidas ao
vivo (`matchPoints()` sobre o placar em andamento, ainda sem `goalsHome`/`goalsAway` salvo em
`s.phases[...].matches[leg]`) por cima do total oficial — nunca tenta prever quem se classifica
ao vivo (depende do agregado das duas pernas + prorrogação/pênaltis, especulativo demais pra uma
perna em andamento). Setas de movimento (▲/▼) no Ranking exibido normalmente, mesmas classes/
textos do BR2026 (`rankMovementHtml`). Novo hero `#liveRankingHero` logo abaixo do card "ao
vivo", mesmo padrão do BR2026 v1.55: mostra TODO MUNDO ordenado por posição (não só quem se
move), com scroll e cabeçalho fixo, só aparece com tie(s) ao vivo E pelo menos alguém realmente
subindo/descendo.

`rankEntriesBy()` — única implementação do desempate, extraída de dentro de `renderRanking()` pra
ser reaproveitada por `calculateRankingMovement()` também, mesmo princípio "fonte única" do
BR2026 (nunca duas implementações do mesmo cálculo que podem silenciosamente divergir — classe de
bug do CHANGELOG v4.57 da Copa).

Achado testando (não em produção): a marcação de acessibilidade (`<span class="visually-hidden">`)
usada pelas setas de movimento não tinha a classe CSS correspondente definida neste app —
sem ela, o texto do título/tooltip aparecia como texto visível solto na tela em vez de ficar
escondido. Corrigido antes de publicar (mesma definição do BR2026).

### Fixed — "Próxima partida" mostra todos os jogos do dia seguinte, não só o primeiro

Mesmo achado do BR2026 (Eduardo: "proximo jogo mostra somente um, mas amanha tem mais, mostre
proximos jogos quando ha mais de um no mesmo dia"). `findNextUpcomingMatch()` continua existindo
(é só "a partida mais próxima"); nova `findAllUpcomingMatchesOnNextDay()` agrupa por dia em cima
dela — card mostra a lista quando há mais de uma partida no mesmo dia, mantém o layout rico
(contador regressivo) quando há só uma.

### Fixed — relógio ao vivo mudava de formato quando pausava

Mesmo bug do BR2026 (Eduardo, screenshot: "Um cronometro mostra só minutos e outro mostra
minutos e segundos. Fere inconsistência!") — código idêntico aqui, mesma correção: sempre passa
por `formatMatchClock()` quando `clockSeconds` existe, pausado só significa não somar o tempo
decorrido desde o último poll.

### Changed — número de posição do Ranking sem ponto sobrando ("2." → "2")

Mesmo ajuste da Copa e do BR2026 no mesmo patch (mesmo trecho de código nos três) — Eduardo:
"e tira o '.' se a posicao nao muda no ranking, parece sujeira".

`audit_scoring.py`: PASSOU — nenhuma fórmula de pontuação tocada, só apresentação do card ao
vivo, cálculo de PROJEÇÃO ao vivo (aditivo, nunca sobrescreve o oficial) e o card "próxima
partida".

## v3.39 — 2026-07-16

### Fixed — merge de entradas sempre preferia o cache local, escondendo edição de admin

Mesmo achado do BR2026 v1.52 (edição de admin direto no Supabase "não aparecia" em navegador
com cache antigo), propagado aqui por ter a mesma estrutura de merge. `mergeStates()` agora
prefere sempre o registro mais recente por entrada (`updatedAt`/`createdAt`), mesmo padrão já
usado pela Copa, em vez de "local sempre vence".

Não altera scoring, bracket nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v3.38 — 2026-07-16

### Security — senha do admin atualizada

Ver nota completa em `bolao/CHANGELOG.md` v4.140 — mesma troca, propagada aos três apps
(já compartilhavam o mesmo hash).

Não altera scoring, bracket nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v3.37 — 2026-07-16

### Fixed — badge "Pago"/"Pendente" vazando da própria caixa em telas estreitas

Mesmo achado do BR2026 v1.49 (Eduardo: "the pago is outside the box"), propagado aqui por ter a
mesma reutilização de `.rank-row`. Ver nota completa em `bolao/CHANGELOG.md` v4.139. Nova classe
`.rank-row.participant-row` com `grid-template-columns: 28px 1fr auto;` em `renderParticipants()`.

Confirmado com medição de DOM real: badge "Pendente" agora mede 79px e cabe com 13px de folga
(antes: forçado em 40px, coluna dimensionada só pro placar de 1-3 dígitos do ranking).

Não altera scoring, bracket nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v3.36 — 2026-07-16

### Fixed — entrada podia ser salva sem responsável pelo pagamento nem método de pagamento

Mesmo achado do BR2026 v1.48 (Matheus/Gustavo salvos com responsável/método vazio), propagado
aqui por ter o mesmo `saveEntry()` copiado sem a validação da Copa. Corrigido: `saveEntry()`
agora bloqueia o salvamento se `payerName` ou `paymentMethod` estiverem vazios, mesmo alerta e
mesma posição da checagem que a Copa (`bolao/js/app.js`).

### Fixed — endurecido `overflow-x: hidden` para `overflow-x: clip` (side-scroll voltou no BR2026)

Ver nota completa em `bolao/CHANGELOG.md` v4.138 (mesma correção, propagada aos três apps).
`overflow-x: hidden` sozinho não impede o "rubber-band" horizontal do iOS Safari quando um
ancestral usa `position: sticky` + `backdrop-filter` (o `.topbar`, idêntico nos três apps);
trocado para `overflow-x: clip` (com `hidden` como fallback). Não foi possível reproduzir com
Chromium no sandbox — correção especulativa e propagada por prudência.

Não altera scoring, bracket nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v3.35 — 2026-07-16

### Fixed — vão vazio grande no final de toda página (mobile e desktop)

Mesmo achado do BR2026 v1.47 (Eduardo: "There's a lot of empty space (non urgent) at the very
bottom of the page"), propagado aqui por ter a mesma estrutura de `main`/`.sticky-submit`. Root
cause: `main` tinha `padding-bottom: 80px` (base e mobile), bem maior que o padrão da Copa
(referência visual canônica) — `20px` desktop / `12px` mobile — apesar de ter a mesma estrutura
de botão sticky no final do formulário de palpites; a folga do sticky já vem do próprio
`position: sticky`, os 80px só sobravam como vão morto em toda aba.

- `main { padding: 16px 14px 80px; }` → `padding: 16px 14px;` (desktop)
- `main { padding: 12px 10px 80px; }` → `padding: 12px 10px;` (mobile, `@media max-width: 900px`)

Confirmado com Playwright (scroll até o fim, screenshot): `scrollHeight` mobile caiu de 4091px
para 4023px (-68px, os 80px→12px esperados); botão sticky continua funcionando normalmente.

Não altera scoring, bracket nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v3.34 — 2026-07-16

### Fixed — "Palpites" continuava clicável depois do prazo da fase ativa; propagado padrão da Copa

Mesmo achado do BR2026 v1.46 (Eduardo: "once it cuts disable the palpites button like copa and
default to ranking like copa"), propagado aqui por ter a mesma estrutura de `init()`. O "default
to ranking" já existia (`showSection(isPastEntryCutoff() ? "ranking" : "entry")`); faltava
desabilitar o botão de navegação "Palpites" em si depois do prazo da fase ativa — adicionado
`navEntryBtn.disabled = isPastEntryCutoff()`, mesmo padrão da Copa (`init()`,
`navEntryBtn.disabled = isPastCutoff()`).

Mesma limitação da Copa/BR2026, não nova: computado uma vez no `init()`, não reativamente — se o
prazo da fase ativa vence com a aba já aberta, ou se uma nova fase começa depois do `init()`, o
botão só reflete o estado correto no próximo carregamento.

`audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v3.33 — 2026-07-16

### Added — triple confirmation + journal de admin + backups automatizados para ações manuais destrutivas

Eduardo pediu para remover os controles manuais do admin (deletar confronto, entrar resultado
manual, marcar resultado real — automatizar tudo via ESPN), depois reverteu antes de qualquer
código ser tocado ("it doesn't hurt to have and don't want to waste tokens on this") — nada foi
removido. Em vez disso, pediu proteção contra mis-click mobile e um jeito de reverter: "make sure
there's triple confirmation if I click incorrectly it can be rolled back easily... what I want to
avoid is to fat finger something... we need to have a way to journal this so it can be rolled
back if needed... the same way copa has, this also needs to have backups done." Ver nota completa
em `docs/bolao/CONSISTENCY_MATRIX.md` (propagação do padrão já existente na Copa).

- **Triple confirmation**: remover confronto (`data-remove-tie`), lançar placar manual
  (`data-save-leg`), apagar placar para reeditar (`data-edit-leg`), travar/destravar resultado do
  confronto (`data-lock-tie`/`data-unlock-tie`) agora exigem dois `confirm()` + um `prompt()`
  digitando a palavra `CONFIRMAR` (`tripleConfirm()`) — o terceiro passo é o que resiste a
  toques acidentais em sequência, não só repetição de `confirm()`. Cadastrar confronto
  (`data-add-tie`) não foi alterado — é reversível (basta remover) e não sobrescreve nenhum
  resultado.
- **Journal**: novo `s.auditLog` (mesmo padrão da Copa — `appendAdminAuditLog()`, merge por
  timestamp entre dispositivos, cap de 200, exibido no admin em `renderAdminAuditLog()`)
  registrando cada uma das cinco ações acima com detalhe suficiente para reverter manualmente se
  necessário (times, placar, fase, confronto).
- **Backups**: `exportJsonBackup()` já existia (equivalente ao `backupJson()` da Copa). Novo:
  `bolao/scripts/backup.py` e `backup_daily.py` agora cobrem os três apps (`main`/`br2026`/
  `cdb2026`) na mesma execução — o cron diário existente (01:00 AM EDT) passa a fazer backup do
  CDB2026 também, sem precisar de entrada de cron nova.

Não altera scoring, bracket nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v3.32 — 2026-07-16

### Fixed — "Ver palpites" aparecia antes do prazo sem fazer nada útil; Pago/Pendente no ranking público

Eduardo, screenshot desta tela: "Ver palpites ainda aparece e so deve aparecer apos o cutoff
time. E tambem não precisa pago e pendente, só para o admin." Mesmo achado do BR2026 v1.43,
propagado aqui (estrutura idêntica):

- **"Ver palpites"**: botão sempre visível no ranking, mesmo antes do prazo da fase ativa — só
  levava a uma mensagem "escondido até o prazo" (`renderPickDisplay()` já protegia o dado, sem
  vazamento real, mas o botão era um toque morto). Corrigido: botão e painel de detalhe só
  renderizam quando `isPastEntryCutoff()` (prazo da fase ativa) já passou.
- **Pago/Pendente no ranking**: a Copa (referência visual canônica) nunca mostrou esse badge na
  linha do ranking — só existe na aba Participantes. Removido da linha do ranking, igualando à
  Copa; segue existindo em Participantes (transparência pública de quem já pagou, sem mudança
  aí).

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v3.31 — 2026-07-16

### Fixed — badge "Pago" divergente da Copa (checkmark); página podia rolar para o lado no mobile

Mesmo achado do BR2026 v1.42, propagado aqui (mesmo bug, mesmo texto `paid: "✓ Pago"` copiado):

1. Badge "✓ Pago" com checkmark não existia na Copa (referência visual canônica, só "Pago") —
   glyph de fonte diferente inflava a altura da pílula no mobile. Corrigido: `paid: "Pago"`.
2. `html`/`body` sem `overflow-x: hidden` — nenhuma rede de segurança contra rolagem horizontal
   da página inteira. Adicionado, verificado que não quebra `.picks-detail`/scroll interno nem o
   header sticky.

Não altera scoring nem lógica de negócio. `audit_scoring.py`: 5/5.

## v3.30 — 2026-07-15

### Added — comprovante abrível/baixável (item 9 do CONSISTENCY_MATRIX.md); tabela de regras sem cabeçalho extra

`#receiptBox` já existia (código + texto), mas sem jeito de abrir/imprimir/baixar. Adicionados
`openReceipt()`/`downloadReceipt()` (Blob URL, nunca `document.write`, mesmo padrão da Copa) e os
botões correspondentes, reaproveitando o `receiptHtml()` já usado no e-mail.

Também removido o `<thead>` extra nas duas tabelas da aba Regras (pontuação e prêmios) — a Copa
usa `.rules-table` só com `<tbody>`.

`audit_scoring.py`: PASSOU (mudança é só de exibição, nunca grava resultado oficial).

## v3.29 — 2026-07-15

### Added — prévia de pagamento no formulário de entrada (paridade com a Copa)

Mesma correção do BR2026 nesta data. `renderPaymentBox()`/`#paymentBox` portados exatamente da
Copa — prévia do método de pagamento (handle/QR/link) assim que selecionado, disparado no
`change` do select e ao carregar uma entrada via "Buscar minha entrada".

`audit_scoring.py`: PASSOU.

## v3.28 — 2026-07-15

### Fixed — Pot no lugar errado; barra de estatísticas sem equivalente na Copa removida

Mesma correção do BR2026 nesta data (código idêntico entre os dois apps até aqui). Pot movido do
stats bar de Participantes (sem equivalente na Copa) para `.pot-box` no cabeçalho do Ranking
(`#potValue`), igual à Copa. Barra de estatísticas removida.

### Added — audit_scoring.py (item 1 do CONSISTENCY_MATRIX.md)

Novo `bolao/cdb2026/scripts/audit_scoring.py` — transcrição em Python da fórmula real de
`matchPoints()`/`scoreEntry()` (exato/resultado/lado mutuamente exclusivos, bônus de confronto,
bônus de pódio campeão/vice, cascata de desempate), com 5 checagens. Especialmente relevante
aqui: Oitavas com jogo real dia 1º de agosto, dinheiro real em jogo, sem proteção nenhuma até
agora. Mesma ressalva que o BR2026: não existe um script server-side rodando sem supervisão pra
auditar contra (diferente da Copa/`send_result_email.py`) — o valor é manter esta transcrição
sincronizada com `app.js` à mão sempre que scoring mudar.

`audit_scoring.py` da Copa: PASSOU. `audit_scoring.py` do CDB2026 (novo): PASSOU.

## v3.27 — 2026-07-15

### Fixed — tela "Participantes" com layout diferente da Copa

Mesma correção do BR2026 nesta data (código idêntico entre os dois apps até aqui): trocado
`.participant-row` (próprio, sem ícone, sem método de pagamento visível) por `.rank-row`
(ícone 👤 + nome/pagador/método numa linha só + chip de status), igual à Copa. `.unpaid-badge`
alinhado para cor neutra (era vermelho/alarme) — "ainda não pago" é estado normal durante
inscrição, mesmo tratamento que a Copa dá. CSS morta removida.

`audit_scoring.py`: PASSOU (mudança é só visual).

## v3.26 — 2026-07-15

### Added — status de confronto adiado/cancelado + timeout de rede no Supabase (itens 25/44/50)

Continuação da rodada de auditoria/correção pedida por Eduardo.

- **Detecção de jogo adiado/cancelado**: `fetchEspnCandidates()` agora também sinaliza
  `postponed` (mesma checagem do BR2026 — `type.name === "Postponed"/"Canceled"`).
  `fetchLiveTies()`/`pollLiveTies()` (recurso ao vivo do v3.25) reaproveitados para também casar
  pernas adiadas por identidade de mandante, não só as "in"; novo `isLegPostponed()` consultado
  na aba "Jogos" pra mostrar um chip "Adiado" no lugar da data.
- **Chip de status de jogo** (`.game-status` — `live`/`post`/`pre`/`postponed`): CDB2026 não
  tinha nenhum, só o `.paid-badge`/`.unpaid-badge` de pagamento. Portado do BR2026, mesmas
  classes/cores.
- **Timeout de rede (`AbortController`)** nas chamadas ao Supabase (`loadRemoteState()`/
  `saveRemoteState()`/`clearAllData()`), que usavam `fetch()` cru sem timeout — só
  `fetchEspnCandidates()` já tinha. Novo `fetchJson()` genérico (mesmo nome/padrão do BR2026).
  Também aplicado ao `checkVersion()` da IIFE de auto-reload (escopo isolado).

`audit_scoring.py`: PASSOU (mudança não toca scoring).

## v3.25 — 2026-07-15

### Added — jogo ao vivo (placar + relógio em tempo real), recurso que nunca existiu aqui

Eduardo pediu auditoria comparando o recurso de "jogo ao vivo" entre Copa/BR2026/CDB2026 (com o
BR2026 se aproximando) e depois pediu correção completa pra bater exatamente com a Copa. Achado
mais sério da auditoria: CDB2026 nunca teve NENHUMA experiência de jogo ao vivo pro participante
— só `autoSyncEspnFull()` (sincronização de resultado FINAL a cada 5 min, em segundo plano, nunca
mostra nada em tela). Como as Oitavas são mata-mata real (primeiro jogo dia 1º de agosto,
prorrogação/pênaltis genuinamente possíveis), era a maior divergência real da plataforma.

**Portado quase literalmente da Copa** (`bolao/js/app.js`), por pedido explícito ("tem que bater
exatamente com o da Copa"): `formatMatchClock()` (relógio consciente de period — 1/2 tempo normal,
3/4 prorrogação, 5 pênaltis — com acréscimo de até 8min e teto pra prorrogação, mesmo fix do bug
real "120:07 (+1)…" que a Copa pegou ao vivo em Austrália×Egito), `mergeLiveClock()` (monotônico,
nunca anda pra trás a não ser que a ESPN sinalize um reset de período legítimo),
`detectClockPaused()` (detecta intervalo/pausa real comparando dois polls crus, funciona mesmo
quando o texto de status da ESPN não bate com as regras de reconhecimento).

**Novo, específico do modelo de fases do CDB2026** (não existe equivalente na Copa, que usa
bracket fixo): `fetchEspnCandidates()` estendida com campos ao vivo
(`state`/`clockSec`/`period`/`isHalftime`/`isPenalties`/`clockStr`), sem tocar nos campos que
`autoSyncEspn()`/`autoSyncEspnResults()` já dependiam (nenhuma mudança na sincronização de
resultado existente). `fetchLiveTies()`/`pollLiveTies()` casam cada perna (ida/volta) de cada
confronto da fase ATIVA por identidade de mandante (mesmo padrão de `autoSyncEspnResults`, nunca
por ordem de data) contra os eventos "in" da ESPN. Novo card `#liveTieCard` (mesmas classes CSS
`.live-*` da Copa/BR2026), poll de 60s dedicado — separado do sync de resultado final de 5 min,
concerns diferentes: exibição em tempo real nunca grava nada no estado/Supabase, só o admin
travando resultado grava de verdade.

### Testado (simulação manual, sem acesso de rede a hosts externos neste ambiente)

Tracei à mão o ciclo de vida completo de uma partida de mata-mata contra a lógica implementada:
1º tempo → intervalo (relógio mostra "Intervalo" fixo, não soma segundos através da pausa) → 2º
tempo (retoma corretamente ao detectar mudança de period) → acréscimo → fim de regulação →
prorrogação (mesma transição, mesmo "serrote" de um ciclo de poll que a Copa também tem — ver
nota abaixo) → fim de prorrogação → "Pênaltis" (rótulo fixo, sem relógio). Nenhum caminho testado
grava placar/resultado oficial — só exibição.

`audit_scoring.py`: PASSOU (mudança é só de exibição ao vivo).

### Limitação conhecida, herdada de propósito da Copa

Uma transição de period (fim de 1º tempo → prorrogação, fim de prorrogação → 2º tempo de
prorrogação) pode fazer `detectClockPaused()` marcar `clockPaused: true` por UM ciclo de poll
(60s) só porque o relógio cru caiu de valor — mesmo sendo um reset de period legítimo, não uma
pausa real. Nesse ciclo o card mostra um relógio estático em vez de continuar contando, e se
autocorrige no poll seguinte. **Mesmo comportamento exato da Copa** (algoritmo idêntico,
copiado propositalmente) — o próprio Eduardo confirmou que o relógio da Copa "ainda não está
100%" e que isso fica pra depois ("até 2030 a gente arruma isso"). Não é uma regressão introduzida
aqui, é paridade fiel com o que já existia.

## v3.24 — 2026-07-14

### Fixed — caixa de placar ainda desproporcional depois da correção de hoje (revisão)

Eduardo mandou print de novo: mesmo depois da correção de padding/font-size mais cedo hoje
(be9e656), a caixa de placar continuava visivelmente grande/quadrada em relação ao dígito e ao
nome do time ao lado.

**Causa raiz real**: a correção de hoje cedo copiou o PADDING do placar da Copa (8px vertical)
sem copiar o LAYOUT que faz aquele padding funcionar lá. Na Copa, o placar vive num grid de 2
colunas largas (`.score-inputs`), então 10-8px de padding vertical não incomoda numa caixa larga.
No CDB2026, a caixa divide uma única linha com nome do time + escudo + "×" (`.tie-inputs` é
flex, não grid), então precisa ser estreita (~40-44px) — manter padding vertical grande numa
caixa estreita produz uma caixa quase quadrada e vazia, exatamente a queixa do Eduardo.

**Correção**: reduzido o padding vertical bem mais que o horizontal (`8px 4px` → `4px 3px`),
`width` ajustado de 44px para 40px. Resultado: caixa vira um retângulo curto (~40×31px),
proporcional a um número de 1-2 dígitos, mantendo alvo de toque acima do mínimo AA do WCAG
(24×24px). Aplicado nos dois lugares (formulário de palpite do participante e formulário de
resultado do admin), mesma consistência interna que a correção de hoje cedo já buscava.

Escopo confirmado como específico do CDB2026: BR2026 não tem nenhum input de placar por partida
(pool de classificação, não mata-mata); a Copa não tem esse problema estruturalmente (layout em
grid largo, não flex estreito). Nada a propagar.

`audit_scoring.py`: PASSOU (CSS-only, scoring não foi tocado).

## v3.23 — 2026-07-14

### Fixed — ordenação cronológica também no formulário de Palpites

Eduardo mandou um print mostrando o formulário de Palpites com Santos×Remo antes de
Mirassol×Grêmio, achando que a ordenação (v3.21) não tinha funcionado. Na verdade nunca foi
aplicada ali: v3.21 foi deliberadamente restrita à aba "Jogos" (`renderGamesSection()`), a
pedido explícito de "fix pequeno e pontual" — o formulário de Palpites (`renderPickForm()`)
continuava na ordem crua de inserção do objeto de estado.

Aplicada a mesma ordenação (`firstLegKickoffMs()`, já existente desde v3.21) também em
`renderPickForm()` — confrontos sem kickoff conhecido ainda ficam no fim, mesmo comportamento.
Nenhuma mudança em cutoff, validação ou pontuação.

`audit_scoring.py`: PASSOU (scoring não foi tocado).

## v3.22 — 2026-07-14

### Fixed — caixa de placar do formulário de palpites desproporcional ao dígito

Eduardo reportou (com print) que a caixa de placar no formulário de palpites (ida/volta) estava
visivelmente grande demais em relação ao número pequeno dentro dela.

Causa: `.tie-inputs input[type="number"]` (e o equivalente no admin, `.admin-leg-row
input[type="number"]`) só definiam `width: 48px`, herdando o `padding: 10px 12px` genérico de
`input, select` — 20px de padding vertical numa caixa com um dígito de 15px cria bastante espaço
morto. Corrigido reaproveitando o tratamento visual que a Copa já usa no próprio placar
(`.score-inputs input`, `bolao/css/styles.css`): dígito maior e mais grosso (`font-size:18px;
font-weight:900`) preenche a caixa em vez de esvaziá-la, com padding reduzido (`8px 4px`) e
largura levemente menor (`44px`, ainda confortável pra 2 dígitos no tamanho de fonte maior).
Aplicado nos dois lugares (formulário de palpite do participante e formulário de resultado do
admin) para consistência dentro do próprio app.

### Testado

- Regressão visual confirmada via screenshot Playwright antes/depois.
- Suíte de regressão (`test_admin_leg_save.js`, `test_round2_fixes.js`, `test_seed.js`) sem
  falhas.
- `node --check`; CSS brace balance; `audit_scoring.py` passou (mudança é só CSS).

## v3.21 — 2026-07-14

### Fixed — aba "Jogos" fora de ordem cronológica

Eduardo pediu um fix pequeno e pontual: ordenar os confrontos da aba "Jogos" por data. Cada
confronto dentro de uma fase renderizava na ordem de inserção do objeto de estado (ordem em que
foram cadastrados/sincronizados da ESPN), não pela data real do jogo. Corrigido em
`renderGamesSection()`: ordena pela data da perna de **ida** (`firstLegKickoffMs()`, sempre o
primeiro item de `legsForFormat(format)` — `"first"` em confrontos de ida+volta, `"single"` em
partida única; nunca a volta, como pedido explicitamente). Confrontos sem kickoff conhecido ainda
(aguardando sorteio/data) ficam no fim da lista, na ordem em que já estavam, em vez de embaralhar.
Escopo intencionalmente restrito à aba "Jogos" — não toca a ordem do formulário de palpites nem
nenhuma lógica de cutoff/pontuação.

**Checagem de propagação**: BR2026 já ordena sua lista de jogos por `dateISO`
(`renderGamesSection()`) — CDB2026 era a exceção. A Copa não tem esse problema estruturalmente
(`DATA.knockoutMatches` é um array estático já ordenado, não um objeto de ties dinâmico). Nada a
propagar; esta correção só alinha o CDB2026 ao padrão que o BR2026 já seguia.

`audit_scoring.py`: PASSOU (scoring não foi tocado).

## v3.20 — 2026-07-14 (EMERGENCY_HOTFIX, mesmo dia)

### Fixed — "editar entrada" liberado o tempo todo desde a v3.9; devia continuar fechado até a Oitavas terminar

Eduardo trouxe dois pontos no mesmo report: (1) "editar entrada" não precisa estar ativo agora,
só deve abrir depois que a Oitavas terminar, e deve continuar desabilitando novas entradas depois
dessa fase; (2) a página padrão deve ser Palpites, a não ser que esteja fechado para palpites (aí
sempre Ranking) — dizendo que isso tinha sido pedido hoje de manhã e "pelo jeito não foi
implementado corretamente".

**Ponto 2 (página padrão) — já estava correto, sintoma explicado pelo v3.19**:
`showSection(isPastEntryCutoff() ? "ranking" : "entry")` já é exatamente essa regra, idêntica nos
3 apps, e já tinha sido verificada com teste automatizado no v3.17 desta manhã. O motivo de
parecer errado era efeito colateral direto do bug de confrontos-fantasma corrigido em v3.19 (dos
112 "confrontos" da fase Oitavas, só 8 eram reais — os outros 104 tinham kickoff no passado e
arrastavam `isPastEntryCutoff()` para `true` incorretamente, fazendo a página abrir em Ranking).
Nenhuma mudança de código adicional necessária aqui — resolvido automaticamente pela cura
automática do v3.19 assim que rodar.

**Ponto 1 (editar entrada) — bug real, separado, não coberto pelo v3.19**: achado ao investigar
por que o gate de `fase1Complete()` nunca travava nada. Histórico: no modelo antigo (bracket fixo,
pré-rewrite v3.0), existia `oitavasComplete()` -- "editar minha entrada" só abria depois que os
confrontos das Oitavas (a primeira fase pickável naquele modelo) tivessem resultado. Na reescrita
de 2026-07-13 pro modelo real de 9 fases, essa função foi renomeada mecanicamente para
`fase1Complete()`, checando `fase-1` -- mas no modelo novo `fase-1` é uma fase HISTÓRICA (uma das
4 primeiras rodadas da Copa do Brasil real, já concluída antes deste bolão existir,
`DATA.phasesConcludedNoData`), não a Oitavas. Isso quebrou o gate de duas formas ao longo do dia:
primeiro (v3.8) o gate ficou travado PARA SEMPRE (fase-1 nunca teria confronto cadastrado no app,
`phaseFullyResolved()` nunca seria `true`); depois (v3.9) a correção para esse travamento
adicionou `DATA.phasesConcludedNoData.includes("fase-1") → true`, o que tecnicamente resolveu o
travamento mas fez a checagem virar um no-op permanente -- fase-1 é SEMPRE "concluída" por
definição, então "editar minha entrada" ficou **liberado o tempo todo desde a v3.9**, quando devia
continuar fechado até a Oitavas (a fase que o participante realmente palpita primeiro) terminar de
verdade.

**Correção**: `fase1Complete()` renomeada para `oitavasComplete(s)`, agora checando
`phaseFullyResolved(s, "oitavas")` -- a fase certa. Card "Buscar minha entrada" (`renderFindEntryCard()`)
e o handler de clique do botão (`findEntryBtn`) atualizados para usar a função corrigida. Mensagem
`findEntryLockedMsg` atualizada de "Disponível assim que os jogos da 1ª Fase terminarem." para
"Disponível assim que os jogos das Oitavas de Final terminarem." (o texto antigo já estava errado
pro modelo atual desde a reescrita de 13/07, ninguém tinha notado porque o gate nunca disparava).

**Nova criação de entrada** já estava correta e não foi tocada: `saveEntry()` já bloqueia entradas
novas depois do cutoff da fase ativa (`isPastEntryCutoff() && !_editingEntry`), independente desta
correção -- essa parte do pedido do Eduardo já funcionava.

**Não é um bypass de trava por fase**: mesmo com o card liberado cedo demais, cada confronto
individual dentro do formulário já ficava corretamente travado por `isPhaseLocked(s, phase.id)`
em `renderPickForm()` assim que o cutoff daquela fase específica passava -- isso roda
independente de `_editingEntry`, então ninguém conseguiria editar um palpite de uma fase já
fechada através deste bug. O problema real era só de UX/sequenciamento: o card "editar minha
entrada" ficava visível e utilizável na fase errada do fluxo (o tempo todo, em vez de só depois
da Oitavas), não uma falha de segurança em cima de picks já travados.

### Verificado

- `audit_scoring.py`: PASSOU (scoring não foi tocado).
- Balanceamento de chaves/parênteses do arquivo inteiro: 0 antes, 0 depois.
- **Sem `node`/Playwright neste ambiente** — mesma limitação do v3.19 desta sessão. Verificação
  manual: único chamador restante de `fase1Complete` é o comentário histórico explicando o bug;
  os dois pontos de uso real (`renderFindEntryCard`, handler do `findEntryBtn`) foram atualizados
  para `oitavasComplete`; `phaseFullyResolved` continua definida antes de qualquer render (hoisting
  de `function` declaration, mesmo padrão já usado no arquivo). Recomendado rodar a suíte completa
  na próxima sessão com Node disponível.

### Classificação

`EMERGENCY_HOTFIX` — regra de negócio explícita do Eduardo (quando o fluxo de auto-atendimento
deve ficar disponível) fora do ar desde a v3.9 (mesmo dia), sem trava de fase individual afetada
(ver nota acima). Reportado por Eduardo como pedido desta manhã não implementado corretamente.

## v3.19 — 2026-07-14 (EMERGENCY_HOTFIX, causa raiz mais profunda que v3.17/v3.18)

### Fixed — Eduardo reportou de novo: "100% incorreto", fechado, sem contador, sem jogos das Oitavas

Depois do v3.18 ir ao ar, Eduardo reportou que o CDB2026 continuava totalmente quebrado em
produção: fechado para palpites, sem contador regressivo, sem os jogos das Oitavas para apostar,
"mostra apenas informação incorreta". Investigação direta no estado de produção (linha
`id='cdb2026'` no Supabase, leitura via chave `anon` pública, sem alterar nada) confirmou um bug
ainda não coberto pelas correções anteriores.

**Causa raiz**: `autoSyncEspn()` criava um confronto novo na fase ativa para **qualquer** par de
nomes de time visto em `fetchEspnCandidates()`, que busca o **ano inteiro** de jogos da Copa do
Brasil (`dates=20260101-20261231`, ~500 eventos de todas as fases) — sem checar se aquele par é de
fato um dos confrontos reais sorteados para a fase atual. Como as fases 1–4 são rastreadas
deliberadamente sem dado nenhum (`DATA.phasesConcludedNoData`), qualquer confronto dessas fases
antigas (times pequenos como CRB, Sousa EC, Galvez, Anápolis) "parecia novo" e caía dentro da fase
Oitavas, que era a `activePhaseId`. Confirmado em produção: dos **112 confrontos gravados na fase
Oitavas, só 8 eram os reais** (`DATA.knownConfrontos.oitavas`); os outros 104 eram lixo de fases
já disputadas entre fevereiro e maio de 2026. **9 desses fantasmas chegaram a ser travados**
(`lockedBy: "espn-auto"`) com um kickoff antigo real anexado — e como `firstKnownKickoffMs()` usa
o kickoff **mais cedo** entre todos os confrontos da fase para calcular o cutoff automático, esses
kickoffs de abril arrastavam o cutoff para o passado, explicando exatamente os três sintomas
reportados de uma vez (fechado, sem contador, Oitavas "erradas"). A cura automática do v3.18
(`healFalseEspnAutoResults`) não pegava este caso porque sua prova de corrupção exige que
**nenhum** kickoff conhecido do tie já tenha passado — os fantasmas tinham kickoffs reais (de
partidas de fases anteriores), então passavam nessa checagem sem serem revertidos.

**Correção 1 — `autoSyncEspn()` restringido**: só cria um confronto novo se o par de times já é um
dos confrontos **realmente sorteados e conhecidos** para aquela fase
(`DATA.knownConfrontos[phaseId]`, curado manualmente — mesma fonte que já alimentava
`seedKnownConfrontos()`/`backfillOitavasKickoffs()`). Sem essa curadoria para uma fase (ex.:
Quartas antes do sorteio real), a função não cria nada — cadastro continua manual pelo admin,
como já era o modelo antes da automação de ESPN existir.

**Correção 2 — `healPhantomTies()`**: auto-cura de execução única (mesmo padrão de
`healFalseEspnAutoResults`), roda na inicialização depois do merge com o Supabase. Remove qualquer
confronto cujo par de times não esteja na lista curada de confrontos reais da sua fase — nunca
mexe em fase sem lista curada, e nunca remove um confronto que tenha pelo menos um palpite real de
participante referenciando-o (defesa extra; confirmado manualmente que a única entrada real hoje
em produção não tem nenhum palpite nos 104 confrontos fantasma).

### Verificado

- Estado de produção lido diretamente do Supabase (leitura, chave `anon` pública, sem escrita) e
  analisado com script Python ad-hoc: confirmado 112 ties na fase Oitavas contra 8 reais, 9
  travados incorretamente, 0 palpites de participantes reais afetados.
- `audit_scoring.py`: PASSOU (scoring não foi tocado — esta correção é só sobre quais confrontos
  existem/são criados, não sobre como pontos são calculados).
- **Sem acesso a `node`/Playwright neste ambiente** — não foi possível rodar a suíte automatizada
  de 89+ testes referenciada em v3.16–v3.18. Verificação manual: releitura completa do diff,
  checagem de balanceamento de chaves/parênteses do arquivo inteiro (0 antes, 0 depois da
  correção), e a lógica de `healPhantomTies()`/`autoSyncEspn()` segue exatamente o mesmo padrão já
  testado de `healFalseEspnAutoResults()`/`withinResultMatchWindow()` (v3.17/v3.18). Recomendado
  rodar a suíte Playwright completa na próxima sessão com acesso a Node antes de considerar este
  incidente 100% fechado.
- A correção do estado de produção acontece automaticamente no próximo carregamento do app por
  qualquer visitante (mesmo padrão de auto-cura do v3.18) — não foi necessária nem realizada
  nenhuma escrita manual direta no Supabase.

### Classificação

`EMERGENCY_HOTFIX` — bug em produção bloqueando entrada de palpites reais (dinheiro em jogo),
reportado por Eduardo como "100% incorreto". Continuação do mesmo incidente do dia (v3.16 → v3.17
→ v3.18 → v3.19), causa raiz mais profunda que as duas correções anteriores endereçavam.

## v3.18 — 2026-07-14 (EMERGENCY_HOTFIX, mesmo incidente do v3.17)

### Fixed — o v3.17 sozinho não bastou; Eduardo continuou sem conseguir cadastrar palpites

Minutos depois do v3.17 (guarda de janela de data no casamento de evento ESPN) estar pronto,
Eduardo reportou de novo, com prints de tela confirmando: banner "Encerrado" no topo mesmo com o
card "Próxima partida" mostrando corretamente 18 dias até Vasco × Fluminense (kickoff real
conhecido, no futuro) — E os jogos das Oitavas no admin "Resultados" também não deixavam entrar
placar. Pediu explicitamente: "esse negócio de resultado manual não funciona, implemente igual a
Copa do Mundo, urgente" e, quando sugeri destravar manualmente os confrontos afetados: "no manual
clean up, do it automatically."

**Causa raiz real, mais fundamental que o v3.17 sozinho resolvia**: `effectivePhaseCutoffMs()` dava
prioridade INCONDICIONAL a um `cutoffAt` manual sobre o valor automático, para sempre, sem
checagem de validade nenhuma — um valor manual esquecido de testes anteriores ao mecanismo de
auto-cálculo travava a fase inteira, mesmo com o kickoff real (Ago/2026) sendo conhecido e ainda no
futuro. Essa ambiguidade manual-vs-auto é algo que a Copa nunca teve (lá o cutoff é um valor único,
sem toggle nenhum) — daí o pedido explícito do Eduardo para reproduzir essa simplicidade aqui.

**Correção 1 — `effectivePhaseCutoffMs()` simplificado**: quando existe kickoff conhecido pra fase,
o auto-calculado (kickoff mais cedo − 1h) SEMPRE vence, sem exceção. `cutoffAt` manual passa a ser
só um fallback para quando NENHUM kickoff é conhecido ainda (seu propósito original, antes do
auto-cálculo existir). Isso elimina essa classe de bug de vez, não só nesta fase — não existe mais
nenhum caminho de código onde um valor manual esquecido consegue travar uma fase com kickoff real
conhecido no futuro.

**Correção 2 — auto-cura automática, sem limpeza manual** (`healFalseEspnAutoResults()`, roda uma
única vez na inicialização, depois do merge com o Supabase): reverte sozinho qualquer placar/
travamento que a v3.16 tenha gravado errado por casar um evento antigo/errado da ESPN (ver v3.17).
Prova usada para decidir o que reverter, sem ambiguidade: um resultado `espn-auto` numa fase cujo
kickoff conhecido ainda não passou é logicamente impossível (o jogo não pode ter terminado antes de
começar) — reverte só isso, nunca toca um confronto onde pelo menos um kickoff conhecido já passou
(pode ter sido jogado de verdade), e NUNCA toca um resultado com `resultSource: "admin"` (lançado à
mão pelo Eduardo), mesmo que a fase ainda não tenha kickoff passado.

**Diagnóstico do admin atualizado**: agora distingue com clareza "cutoff manual em vigor" (só
acontece sem kickoff conhecido) de "cutoff manual preenchido mas ignorado" (kickoff conhecido
manda, o campo manual só está lá sem efeito nenhum) — antes das duas apareciam como "manual" sem
diferenciação.

### Testado

- 9 testes novos (`test_heal_false_espn_results.js`): reprodução exata da corrupção reportada (3
  confrontos com combinações diferentes de corrupção parcial/total), confirmação de reversão
  automática sem intervenção manual, confirmação de que um resultado LEGÍTIMO lançado à mão pelo
  admin nunca é tocado (mesmo em fase sem kickoff passado), confirmação de que a cura roda uma
  única vez (não apaga um resultado real lançado depois).
- `test_auto_cutoff.js` atualizado: a asserção antiga ("manual vence") virou a asserção nova e
  correta ("manual desatualizado nunca mais trava a fase").
- Suíte completa (89 testes no total entre os arquivos de CDB2026) re-executada sem falhas reais.
- `audit_scoring.py` passou — scoring não foi tocado (esta correção é só sobre QUANDO uma fase
  fica travada para novos palpites/edição, não sobre COMO a pontuação é calculada).

### Classificação

`EMERGENCY_HOTFIX` — continuação direta do incidente do v3.17, mesmo dia, bloqueando entrada de
palpites reais em produção. Commit/push direto.

## v3.17 — 2026-07-14 (EMERGENCY_HOTFIX)

### Fixed — v3.16's automação de resultado podia casar evento errado (achado horas após o deploy)

Eduardo reportou de novo, horas depois do v3.16 ir ao ar: "CDB2026 continua dizendo fechado, sem
o contador regressivo, sem possibilidade de entrada para palpites das oitavas."

**Causa raiz**: `autoSyncEspnResults()` (v3.16) casava um evento da ESPN com uma perna de confronto
usando SÓ o par de nomes de time (`homeTeam`/`awayTeam`), sem checar proximidade de data —
`fetchEspnCandidates()` busca o ANO INTEIRO da competição (`dates=20260101-20261231`). Se o mesmo
par de nomes de time aparecesse em um evento de uma rodada anterior (ex.: fase-1 a fase-5, já
disputadas meses antes das Oitavas), a função podia preencher o placar de uma perna que nem
começou e travar o confronto errado — explicando os três sintomas de uma vez: `status: "FINAL"`
tira a perna de `findNextUpcomingMatch()` (sem contador regressivo), e `qualifiedTeamId` em todas
as pernas faz `phaseFullyResolved()` tirar a fase inteira do formulário de palpites (fechado, sem
possibilidade de entrada).

**Correção**: nova guarda `withinResultMatchWindow()` — só aceita um evento da ESPN como resultado
de uma perna se a data dele estiver dentro de ±21 dias do kickoff já conhecido daquela perna (ou,
se essa perna específica ainda não tem kickoff próprio — caso comum da volta antes da ida ser
jogada —, do kickoff conhecido de QUALQUER outra perna do mesmo confronto, já que ida e volta
sempre acontecem a poucos dias uma da outra). Sem nenhum kickoff conhecido ainda para o confronto,
mantém o comportamento permissivo anterior (nada para comparar, sem regressão nesse caso).
Aplicada tanto no preenchimento de placar por perna quanto na checagem de vencedor por pênaltis em
agregado empatado.

**Confirmado que não é um bug separado**: a página inicial (aba padrão ao carregar) já usa
exatamente a mesma lógica da Copa (`showSection(isPastEntryCutoff() ? "ranking" : "entry")`,
idêntica nos 3 apps) — verificado com teste automatizado que a aba padrão É "Palpites" com estado
limpo. O que parecia "abrir direto no ranking" era o mesmo bug de cutoff acima fazendo
`isPastEntryCutoff()` retornar `true` incorretamente, não uma lógica de aba padrão diferente.

### Testado

- 5 testes novos em `test_espn_auto_results.js` (total 18): reprodução exata do incidente (evento
  antigo com o mesmo par de nomes de time, 3+ meses antes do kickoff real, é rejeitado) + controle
  positivo (o evento real, perto do kickoff conhecido, continua sendo casado normalmente).
- Suíte completa re-executada sem regressões; `node --check`; `audit_scoring.py` passou.

### Classificação

`EMERGENCY_HOTFIX` — bug em produção bloqueando entrada de palpites reais (dinheiro em jogo).
Commit/push direto, fora do fluxo normal de PR com revisão prévia de findings, por afetar
disponibilidade do bolão em produção.

## v3.16 — 2026-07-14

### Changed — automação da captura de RESULTADO (não só emparelhamento) — autorizado por Eduardo

Eduardo pediu para "automatizar" a atualização de placar do admin. Eu apresentei o risco
documentado (travar um resultado decide pagamento; casar a perna errada num confronto de ida/volta
seria grave — ver `docs/bolao/CDB2026_RULES_AND_MODEL.md` §7) e perguntei explicitamente antes de
mexer. Eduardo escolheu automatizar mesmo assim. Implementado com o máximo de salvaguarda possível
sem inventar dado que a ESPN não fornece:

- **Nova `autoSyncEspnResults()`**, chamada no mesmo ciclo de 5 min que já sincronizava confrontos
  (`autoSyncEspn()`, agora envolvida por `autoSyncEspnFull()`). Preenche o placar de cada perna
  (ida/volta) automaticamente quando a ESPN reporta o jogo como encerrado, e trava o confronto
  (`qualifiedTeamId`) sozinha quando o resultado é inequívoco.
- **Como o risco de "casar a perna errada" foi mitigado**: a identificação de qual evento da ESPN é
  ida e qual é volta usa a identidade do time MANDANTE (o mesmo sinal que a UI manual já usa —
  `home = leg === "second" ? tie.teamB : tie.teamA`), nunca ordem de data. Ida e volta têm mandantes
  sempre invertidos entre si por definição de mata-mata — não há ambiguidade nesse sinal.
- **Como o risco de travar errado foi mitigado**: (1) nunca sobrescreve uma perna que já tem
  placar, seja lançada manualmente ou por um ciclo anterior desta mesma função; (2) nunca
  sobrescreve um confronto já travado (manual ou automático) — corrigir continua exigindo
  "Destravar" na UI, como sempre exigiu; (3) quando o agregado bate diferente, o vencedor é
  inequívoco pelo placar (mesma regra que o botão manual já usava, nenhuma regra nova); (4) quando o
  agregado empata (só decide nos pênaltis — Copa do Brasil não usa gols fora de casa como critério),
  só trava automaticamente se a ESPN reportar um vencedor explícito (campo `winner` da API, que já
  reflete o resultado da disputa de pênaltis). Sem esse dado, a função não adivinha — o confronto
  fica exatamente como ficava antes, esperando o admin escolher manualmente.
- Cada placar/travamento automático fica marcado (`resultSource`/`lockedBy: "espn-auto"`) e mostra
  uma etiqueta "(via ESPN)" na UI do admin, para o Eduardo distinguir de um lançamento manual dele
  a qualquer momento.
- Texto do painel "Sincronizar com a ESPN" atualizado para descrever o novo comportamento com
  precisão (antes dizia que resultado "continua exigindo confirmação manual", o que deixou de ser
  totalmente verdade).

### Não propagado

`TOURNAMENT_SPECIFIC` — Copa não tem sincronização com ESPN (bracket fixo desde o deploy); BR2026
não tem modelo de confrontos/resultado por partida (é projeção de classificação, não mata-mata).
Nada a propagar.

### Testado

- 13 testes Playwright novos (`test_espn_auto_results.js`), cobrindo: agregado não empatado (trava
  correta e inequívoca), agregado empatado com vencedor de pênaltis informado pela ESPN (trava
  correta), agregado empatado SEM informação de pênaltis (não trava, cai pro fluxo manual), perna
  lançada manualmente nunca é sobrescrita pela ESPN, confronto já travado nunca é re-travado/alterado
  mesmo que a ESPN mude o placar depois.
- Suíte de regressão completa re-executada sem regressões reais (uma falha isolada e não-reproduzível
  em `test_urgent_fixes.js`, de um teste do BR2026 não relacionado a esta mudança, confirmada como
  flakiness de timing ao rodar em lote — 13/13 passando ao rodar isolado).
- `node --check`; `python3 bolao/scripts/audit_scoring.py` — passou.

## v3.15 — 2026-07-14

### Fixed — bug em produção ("Oitavas encerrado" incorreto) + consistência com Copa/BR2026

Eduardo reportou (com print de tela) que o formulário de palpites das Oitavas de Final aparecia
100% travado ("Palpite não enviado — prazo desta fase encerrado") mesmo com a fase claramente
aberta. Depois de corrigido, reportou o mesmo bug de novo ("mostrando jogos que passaram e não
mostra mais os jogos atuais"), e também que "Ver palpites" estava inconsistente com a Copa.

- **[BUG EM PRODUÇÃO] `effectivePhaseCutoffMs()` dava prioridade incondicional e silenciosa a um
  `cutoffAt` manual desatualizado**, sem nenhuma indicação de qual fonte (manual vs. automática)
  estava valendo. Um valor manual definido durante testes anteriores, no passado, travava TODAS
  as chaves das Oitavas — o mesmo mecanismo explica os dois reports do Eduardo. Como travar/
  destravar prazo é uma decisão de admin (não dá para adivinhar o estado real do Supabase de
  produção), a correção implementada é um diagnóstico + correção de um clique: `renderAdminPhases()`
  agora mostra explicitamente "Cutoff manual (definido pelo admin): <data>" ou "Cutoff automático",
  com um botão "Usar cálculo automático" que limpa o override manual na hora.
- **[SEGURANÇA — achado real] "Ver palpites" não era protegido por prazo nenhum**, igual ao
  achado no BR2026 — corrigido com o mesmo padrão: `renderPickDisplay()` retorna aviso enquanto
  `!isPastEntryCutoff()`.
- **"Ver palpites" com estrutura visual inconsistente com a Copa** (e também diferente do
  BR2026): usava lista de cards em coluna flex. Reconstruído para `<table>`, mesma estrutura e
  classes CSS que Copa/BR2026 agora usam. CSS morto removido (`.picks-display.cdb-picks`,
  `.pick-item`, `.pick-pos-lbl`, `.pick-cell*`, `.pick-pts-badge`).
- **Email de comprovante inconsistente com Copa/BR2026**: nova `receiptHtml()` (mesmo layout HTML
  base + card de pódio campeão/vice) e formato de código padronizado (`CDB2026-XXXXXXXX-
  YYYYMMDD`). De passagem, corrigida a chamada do EmailJS que ainda usava a assinatura antiga
  (`emailjs.send(sid, tid, params, publicKey)` — 4º argumento como string solta) em vez da forma
  objeto (`{ publicKey }`) já usada em Copa e BR2026.

### Testado

- 13 testes Playwright novos (`test_urgent_fixes.js`), incluindo reprodução exata do bug
  reportado (cutoffAt manual no passado → 8 confrontos travados) e confirmação de que o botão de
  reset destrava.
- Suíte de regressão completa sem regressões; `node --check`; `python3
  bolao/scripts/audit_scoring.py` passou (scoring não foi tocado).

### Não implementado nesta versão

- Pergunta do Eduardo sobre remover a atualização manual de resultado do admin: a sincronização
  de confrontos já é automática (v3.3+), mas travar um RESULTADO (decide pagamento) é uma decisão
  de design deliberada e documentada em `docs/bolao/CDB2026_RULES_AND_MODEL.md` (seção 7) — nunca
  foi automatizada de propósito. Aguardando confirmação explícita do Eduardo antes de alterar,
  por ser regra de negócio que decide pagamento real.

## v3.14 — 2026-07-14

### Fixed — auditoria estilo Big Tech, rodada 2: itens que Eduardo autorizou explicitamente após ver o relatório

Depois do relatório completo da v3.13, Eduardo pediu explicitamente "corrija tudo e implemente".
Este app tinha a maior concentração de achados por ter o painel de admin mais complexo (fases
cadastradas incrementalmente) — implementado o que não mexe em scoring/regra de negócio:

- **🔴 Painel do admin ("Fases e confrontos" e "Resultados") sem proteção contra sync em segundo
  plano**: era o gap de maior severidade do relatório. `adminPhasesFormIsDirty()`/
  `adminResultsFormIsDirty()` novos, mesmo princípio do `pickFormIsDirty()` já usado no formulário
  de palpite. **Bug pego pelo próprio teste automatizado antes de chegar em produção**: a primeira
  versão da correção bloqueava a própria atualização depois de um SALVAMENTO bem-sucedido (o DOM
  antigo ainda mostrava o campo preenchido no instante em que a checagem de "sujo" rodava) —
  corrigido limpando os campos antes de `saveState()` nos handlers de `data-save-leg` e
  `data-add-tie`.
- **"Adicionar confronto" manual sem checagem de par duplicado**: só a sincronização automática
  com a ESPN usava `existingPairsAcrossPhases()`. Reaproveitada no cadastro manual.
- **Nome de time sem normalização**: "corinthians" e "Corinthians" eram tratados como times
  diferentes em tudo (escudo, força, checagem de duplicata). Normalizado contra a lista conhecida
  (`DATA.teamLogos`) antes de salvar.
- **Lançamento de placar real sem limite máximo nem confirmação**: `max="20"` do HTML não bloqueava
  envio via JS. Adicionado limite real (>20 rejeitado) e confirmação para placares fora do normal
  (>10 gols).
- **"Editar" (limpar placar já lançado) sem confirmação**: agora pede confirmação, igual a
  excluir/travar/destravar confronto.
- **Excluir confronto não resolvido deixava palpite órfão sem aviso**: o `confirm()` agora conta
  quantas entradas já têm palpite salvo pro confronto e avisa o admin.
- **Painel do admin não tratava fases sem confronto por design** (`DATA.phasesConcludedNoData`):
  mostrava o formulário completo de "Adicionar confronto" mesmo pra fase-1..4, que nunca deveriam
  ter confronto cadastrado. Agora mostra a mesma nota "já concluída" usada no formulário de
  palpite/aba Jogos.
- **Grade de probabilidade recalculada a cada resync mesmo fora de tela**: agora só roda quando a
  aba Probabilidades está ativa.
- **`aria-label` ausente nos campos de time/prazo do admin**: já corrigido na rodada 1 (v3.13).
- **Alvo de toque mínimo (WCAG) no nav mobile**: `min-height: 44px` — propagado dos 3 apps.

Não implementado nesta rodada (feature-sized, fora do escopo de "corrigir um achado"): colapsar
fases já resolvidas no painel do admin (produto, não correção).

15 testes automatizados novos cobrindo especificamente esta rodada (parte de `test_round2_fixes.js`,
compartilhado com os outros 2 apps), incluindo o bug do self-blocking pego e corrigido durante o
próprio desenvolvimento. `node --check`: OK. `audit_scoring.py`: 5/5 — nenhum valor de pontuação
tocado.

## v3.13 — 2026-07-14

### Fixed — auditoria estilo Big Tech: cutoff automático não travava palpite, ranking mostrava rank errado em empate

Eduardo pediu uma auditoria completa nível Big Tech nos 3 apps (arquitetura, bugs, UX, QA,
segurança, mobile, performance, acessibilidade, consistência, produto), com instrução explícita
de reportar achados primeiro e não alterar scoring/regra de negócio sem autorização. Relatório
completo entregue a Eduardo fora deste changelog; aqui só o que foi corrigido nesta rodada
(verificado lendo o código real antes de cada correção, não só confiando no relatório do agente):

- **🔴 `isPhaseLocked()` ignorava o cutoff automático da v3.12** (código desta mesma manhã): a
  função só olhava `phaseState.cutoffAt` MANUAL diretamente — como esse campo é opcional e o
  auto-cálculo (`entryCutoffMs()`/`firstKnownKickoffMs()`) existe justamente para não depender
  dele, um confronto continuava aparecendo como editável no formulário de palpites mesmo depois
  do cutoff automático (1h antes do kickoff real) já ter passado, até o admin clicar "salvar e
  travar resultado" naquele confronto específico. Corrigido: extraída `effectivePhaseCutoffMs(s,
  phaseId)` (mesmo cálculo manual-ou-automático, reaproveitado tanto por `entryCutoffMs()` quanto
  por `isPhaseLocked(s, phaseId)` agora) — os dois usos do cutoff nunca mais podem discordar sobre
  se uma fase específica já travou. Testado via Playwright: confronto com kickoff 2h no passado e
  nenhum `cutoffAt` manual definido agora aparece travado (sem inputs de placar) no formulário.
- **🔴 Rank/medalha exibidos errados em empate de pontos** (`renderRanking()`): mesmo bug e mesma
  correção do BR2026 (ver changelog daquele app) — o array já era ordenado corretamente pela
  cascata completa de desempate (total → campeão exato → vice exato → nº de placares exatos →
  nome), mas o rank exibido só avançava por `item.total`. Corrigido usando chave composta
  `${total}:${hitChampion}:${hitRunnerUp}:${countExactMatches}`, mesmo padrão já comprovado na
  Copa.
- **`checkVersion()` podia apagar um palpite não salvo:** mesmo bug e mesma correção do BR2026 —
  o poller de deploy não checava se o formulário tinha dado não salvo antes de forçar
  `location.reload()`. Adicionada a mesma checagem de `pickFormIsDirty()` (duplicada localmente,
  IIFE fora do escopo do módulo principal).
- **`aria-label` ausente nos campos de time/prazo do admin** ("Fases e confrontos"): os inputs de
  nome de time e o campo de prazo manual não tinham nome acessível (só `placeholder`, que leitor
  de tela não trata como label) — inconsistente com os campos de placar da linha logo abaixo, que
  já tinham. Adicionado, reaproveitando as mesmas chaves i18n já usadas no `placeholder`.

Achados de maior risco reportados a Eduardo mas não corrigidos automaticamente (fora do escopo de
"patch pequeno e reversível" desta rodada, ou dependem de decisão de produto): painel do admin
("Fases e confrontos"/"Resultados") sem a mesma proteção `pickFormIsDirty()` contra sync em
segundo plano durante digitação, "Adicionar confronto" manual sem checagem de par duplicado
(existe só para sincronização automática via ESPN), entrada de placar do admin sem limite máximo
nem confirmação (ao contrário de excluir/travar/destravar confronto, que já pedem confirmação).

`node --check`: OK. `audit_scoring.py`: 5/5 — scoring (valores de pontos) não tocado, só a
exibição do rank/medalha em caso de empate no total e o enforcement do cutoff já definido em
v3.12.

## v3.12 — 2026-07-14

### Fixed — cutoff automático (1h antes do primeiro jogo) + dados reais da Oitavas em produção

Eduardo, em produção: "ainda esta incorreto... the cutoff should be until 1 hour before the
first game". A v3.11 corrigiu o MECANISMO de leitura do cutoff mas ainda dependia do admin
calcular e digitar manualmente o horário em "Fases e confrontos" — passo que nunca tinha sido
feito, então o contador continuava preso em "aguardando sorteio" mesmo com o mecanismo certo.

Duas mudanças:

1. **`entryCutoffMs()` agora calcula automaticamente**: 1h antes do kickoff mais cedo já
   conhecido entre os confrontos da fase ativa (mesma regra da Copa/BR2026 — ver
   `rulesCutoffText`), sem precisar de nenhum cadastro manual. Um `cutoffAt` definido pelo admin
   continua tendo prioridade quando existir (ex.: se ele quiser fechar mais cedo por algum
   motivo) — nunca sobrescrito automaticamente.

2. **Dados reais da CBF para a Oitavas**: a CBF divulgou a tabela detalhada da Oitavas (ida
   1–3/ago, volta 4–6/ago) depois da Oitavas já ter sido semeada (v3.6) — como
   `seedKnownConfrontos()` só roda uma vez (já rodou em produção) e nunca cria/atualiza confronto
   que já existe, só atualizar `data.js` não bastava: nunca chegaria a quem já tem o app
   rodando. Nova função `backfillOitavasKickoffs()` (flag própria, roda uma única vez, nunca
   sobrescreve `kickoff` que já esteja preenchido — seja por sincronização com a ESPN ou por
   correção futura do admin) preenche `kickoff`/`venue`/`city` da ida em cada um dos 8 confrontos
   já semeados. Confiança por jogo documentada em `data.js` (3 confrontos cruzados em 2+ fontes,
   5 em 1 fonte — Lance!, "CBF divulga datas e horários das oitavas"). Só a ida foi preenchida —
   a volta ainda não tem horário por partida confirmado nas fontes, fica em aberto.

Com isso, tanto o contador do topo quanto o card "Próxima partida" mostram dado real em produção
sem nenhuma ação manual do admin — mesmo comportamento "só funciona" da Copa/BR2026.

19 testes automatizados novos, incluindo o cenário exato de produção (confronto já semeado antes
da tabela existir, sem `cutoffAt` manual, sem kickoff) e confirmando que uma correção manual
futura do admin nunca é sobrescrita pelo backfill. `node --check`: OK. `audit_scoring.py`: 5/5,
sem impacto.

## v3.11 — 2026-07-14

### Fixed — "Próxima partida" não tinha contador nenhum (mesmo achado no BR2026)

Eduardo reportou: "nem próximo jogo br nao mostra countdown do proximo jogo igual copa que
funciona bem. Isso tem que ser 100% consistente". Investigação mais funda desta vez: o card
"Próxima partida" (v3.9) tinha um texto de contador só para jogos em menos de 1h, e mesmo esse
texto não atualizava ao vivo — `renderNextTieCard()` só era chamada de dentro de `renderAll()`
(salvar entrada, resync a cada 30s), sem nenhum `setInterval` próprio, diferente do contador do
topo (`renderCountdown()`, que já tinha um tick de 1s). Corrigido: nova função
`countdownTimerHtml()`, mesmo algoritmo e mesma marcação (`.count-grid` + dias/horas/min/seg em
caixas, variante de 4 colunas quando há dias) do contador da Copa (`renderNextMatch()` em
`bolao/js/app.js`) — substituindo o texto inline. `renderNextTieCard()` entrou no mesmo
`setInterval` de 1s do `renderCountdown()`, então agora atualiza ao vivo.

### Verificado (não era bug) — contador do topo "não aparece"

Eduardo também reportou que o contador do topo (`#cutoffCountdown`) "não aparece ainda". Testado
de ponta a ponta com Playwright simulando o fluxo real do admin (abrir "Fases e confrontos",
digitar uma data, clicar "Salvar prazo"): o mecanismo corrigido na v3.10 (`entryCutoffMs()` lendo
o cutoff da fase ativa) funciona corretamente — assim que um prazo é salvo em Oitavas pelo admin,
o contador passa a mostrar dígitos reais. A causa mais provável do "não aparece" é que esse prazo
ainda não foi cadastrado em produção (Admin → Fases e confrontos → Oitavas de Final → Prazo).
Diferente da Copa/BR2026, que têm um `cutoffIso` único fixo em `config.js` desde o deploy, o
CDB2026 usa um prazo por fase, definido pelo admin (arquitetura deliberada — ver
`CDB2026_RULES_AND_MODEL.md` seção 3.4, cada fase abre/fecha em momentos diferentes conforme o
torneio avança). Isso significa que o contador só aparece depois desse cadastro manual — não é
automático como nos outros dois apps, e essa diferença de comportamento (não de código) segue sem
resolver nesta rodada.

14 testes automatizados novos, incluindo o fluxo completo via UI do admin (não só manipulação
direta de estado). `node --check`: OK. `audit_scoring.py`: 5/5, sem impacto.

## v3.10 — 2026-07-14

### Fixed — esquema de cor dourado (não verde) usado neste app inteiro (achado por Eduardo)

A auditoria "estilo big 4" da v3.9 comparou os TOKENS de cor entre os 3 apps (mesmos valores hex
nos três) mas não verificou se o MESMO token era usado no MESMO elemento — esse foi o buraco real
na auditoria. CDB2026 usava `var(--gold)` como cor primária (título/eyebrow do hero, cabeçalho de
cada fase no formulário de palpites, cabeçalhos de confronto em Jogos/Admin, gradiente de fundo do
hero) onde a Copa e o BR2026 usam `var(--green)` para os mesmos elementos — sem nenhum registro em
`DESIGN_SYSTEM.md` justificando isso como `TOURNAMENT_SPECIFIC`. Alinhado ao verde dos outros dois
apps: `.hero-eyebrow`, `.pick-group-header.champion-header`, `.games-round-header`/
`.admin-round-header`, `.confronto-header`, gradiente do `.hero`. Mantido dourado só em
`.pick-partial` (estado semântico de "parcial", equivalente ao amarelo usado pelo BR2026 para a
mesma ideia — não é cor de marca).

### Fixed — contador regressivo sumiu, virou "aguardando sorteio" para sempre (bug crítico)

Eduardo reportou: "Cdb nao tem contador regressivo antes tinha, sumiu, agora fala aguardando
sorteio". Causa raiz: `fase1CutoffMs()` (usada pelo contador do topo, pelo bloqueio de criação de
entrada nova e pela escolha de aba padrão) sempre lia `phases["fase-1"].cutoffAt` — e fase-1
NUNCA vai ter esse campo preenchido, porque desde a v3.6/v3.8 ela é histórica, sem confronto
cadastrado nenhum (`DATA.phasesConcludedNoData`). Mesmo o admin definindo um cutoff real na fase
que está de fato aberta para palpite (Oitavas), o contador continuava preso em "aguardando
sorteio" para sempre, porque olhava o campo errado.

Renomeada para `entryCutoffMs()`/`isPastEntryCutoff()`, agora lendo o cutoff da fase que está
`espnSync.activePhaseId` (hoje "oitavas") em vez de literalmente "fase-1" — acompanha
automaticamente qual fase está aberta para palpite conforme o torneio avança, sem precisar trocar
um nome de fase hardcoded pelo outro a cada rodada.

11 testes automatizados novos (troca de cor confirmada visualmente + Playwright, contador
funcionando com cutoff real definido em Oitavas, bloqueio de entrada nova respeitando o cutoff
certo). `node --check`: OK. `audit_scoring.py`: 5/5, sem impacto.

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
