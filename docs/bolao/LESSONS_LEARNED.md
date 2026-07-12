# Lessons Learned — Plataforma Bolão

Este documento existe para **ensinar futuras IAs (e pessoas) a não repetir os mesmos erros**
já cometidos e corrigidos nesta plataforma. Cada entrada segue o formato Problema → Causa raiz
→ Como foi corrigido → Como evitar novamente.

Fontes: `bolao/CHANGELOG.md`, `docs/bolao/CHANGELOG.md`, `docs/bolao/BUGS_AND_FEEDBACK.md`,
`bolao/docs/FIX_LOG_*.md`, `docs/bolao/CONSISTENCY_MATRIX.md`, `docs/bolao/PROJECT_MEMORY.md`
e comentários no código-fonte. Nada aqui é especulação — cada bug tem uma referência rastreável
na versão em que foi corrigido.

---

## CSV — quebra de linha (LF vs CRLF)

### Problema
Arquivos CSV exportados pelo admin abriam quebrados no Excel do Windows (tudo em uma linha só,
ou colunas fundidas incorretamente).

### Causa raiz
O gerador de CSV usava `\n` (LF) como quebra de linha. O Excel do Windows espera `\r\n` (CRLF)
para reconhecer corretamente o fim de cada linha em um `.csv` puro (sem BOM/hint adicional).

### Como foi corrigido
Corrigido na Copa em **v3.0**: todo export de CSV passou a usar `\r\n`. Documentado
explicitamente como decisão deliberada no changelog (`CSV: \r\n line endings for Excel.`).

### Como evitar novamente
- Qualquer gerador de CSV novo (nos três apps) deve usar `\r\n`, nunca `\n` puro.
- **Regressão real e conhecida:** BR2026 e CDB2026 reintroduziram o bug com `\n` (LF) em seus
  próprios `exportCsv()` — porque os três apps não compartilham código, a correção da Copa não
  se propagou automaticamente. Catalogado como `OUTDATED`/severidade `Medium` em
  `CONSISTENCY_MATRIX.md` item 14, ainda não corrigido em BR2026/CDB2026.
- Ao criar ou revisar qualquer função de export CSV em qualquer um dos três apps, testar
  abrindo o arquivo gerado no Excel (ou pelo menos grepar por `\r\n` no código).

---

## PDF em branco / comprovante que não renderiza

### Problema
Não há geração de PDF real — o fluxo é HTML autocontido aberto em popup e impresso pelo
navegador ("Salvar como PDF"). O risco real observado nesta categoria não foi um PDF vazio em
si, mas dois problemas adjacentes: (1) a tabela de palpites do comprovante/ranking ficando em
branco por um erro JS silencioso, e (2) o popup do comprovante sendo bloqueado pelo navegador.

### Causa raiz
1. `picksTable()` chamava uma função inexistente (`podiumPicks`) — o nome real era
   `finalPodiumForEntry`. Todo clique em "Ver palpites" no Ranking disparava um
   `ReferenceError` **silencioso** (sem toast, sem log visível ao usuário): a tabela ficava em
   branco e as medalhas 🥇🥈🥉 nunca apareciam.
2. Popups são bloqueados por padrão em muitos navegadores/configurações — `window.open()` para
   o Blob URL do comprovante pode simplesmente falhar sem abrir nada.

### Como foi corrigido
1. Corrigido o nome da chamada para `finalPodiumForEntry(entry)` (`v4.82`).
2. Popup bloqueado é tratado com um `alert()` explicativo (mantido como `alert()` de propósito,
   é um dos únicos casos que continuam bloqueantes) **e** um fallback que não depende de popup:
   "Download HTML" baixa o arquivo diretamente, sem `window.open`.

### Como evitar novamente
- Nunca depender de um único fluxo de exibição (popup) sem um fallback que funcione mesmo com
  popup bloqueado.
- Erros de renderização de comprovante/tabela devem falhar de forma visível (toast/log), nunca
  silenciosamente — um `ReferenceError` dentro de uma função de render pode deixar uma seção
  inteira em branco sem qualquer sinal ao usuário ou ao admin.
- Ao renomear uma função, buscar (grep) todas as chamadas por nome literal antes de commitar —
  este bug não foi pego porque não há verificação de tipos (JS puro, sem TS).
- BR2026/CDB2026 não têm nenhum sistema de comprovante/PDF ainda (gap conhecido, ver
  `CONSISTENCY_MATRIX.md` itens 8–10) — ao implementar, reusar o padrão Blob URL + Download
  HTML da Copa, não `document.write`.

---

## Email multipart / payload além de `html_message`

### Problema
O envio de e-mail via EmailJS tinha um payload com campos além do necessário, o que causava
problemas de template (referências a campos que o template não esperava, comportamento
inconsistente do corpo do e-mail).

### Causa raiz
O template do EmailJS foi originalmente configurado (ou o payload enviado) com múltiplos
campos separados em vez de um único bloco HTML pronto — mistura de responsabilidade entre
"o que o app monta" e "o que o template formata".

### Como foi corrigido
Corrigido na Copa em **v3.0**: o payload foi reduzido para conter **apenas** o campo
`html_message`, já totalmente montado e escapado no lado do app (`receiptHtml()`), e o corpo do
template no EmailJS foi reduzido para conter só `{{{html_message}}}` — nenhum outro campo.
Documentado como regra permanente em `CLAUDE.md` ("Template body must contain only
`{{{html_message}}}` — no other fields").

### Como evitar novamente
- Nunca adicionar um segundo campo de conteúdo ao payload do EmailJS ou ao template — toda a
  montagem de HTML (incluindo escaping de dado de usuário) acontece no app antes do envio, o
  template é só um invólucro passivo.
- Isso também simplifica auditoria de XSS: um único ponto (`receiptHtml()`/equivalente) precisa
  garantir `escapeHtml()`/`esc()` em tudo, não vários pontos de template.

---

## "Time A / Time B" — flash de placeholder antes dos times resolverem

### Problema
Ao carregar o formulário de palpites, havia um instante visível em que os nomes dos times
apareciam como "Time A" / "Time B" (placeholder genérico) antes de resolver para o nome real do
time, criando um flash visual incômodo.

### Causa raiz
As labels de placar tinham um valor inicial genérico ("Time A"/"Time B") que só era substituído
pelo nome real do time depois que a resolução do bracket terminava — a resolução em si é
correta, o problema era a ordem de renderização (mostrar o placeholder antes de ter o dado
final, em vez de esperar).

### Como foi corrigido
Corrigido em **v3.2.1**: a exibição da label A/B foi deferida até o nome real do time estar
resolvido, eliminando o flash. Depois, o próprio dropdown "A / B" genérico foi removido como
conceito (ver também "Traduções incompletas" abaixo, para o caso correlato em BR2026/CDB2026 de
flag+nome como string única).

### Como evitar novamente
- Nunca renderizar um placeholder genérico como primeiro paint quando o dado real está prestes
  a ficar disponível de forma síncrona/quase síncrona — preferir não renderizar nada (ou um
  skeleton neutro) até o dado real estar pronto.
- Esse bug tem uma classe-irmã mobile encontrada muito depois (`v4.86`): quando "time" e
  "nome" são concatenados como uma única string de texto em vez de elementos separados, CSS não
  consegue reordenar por breakpoint — sempre separar em `<span>`s distintos.

---

## Traduções incompletas

### Problema
Várias strings de UI apareciam hardcoded em português independentemente do idioma ativo, ou só
existiam em `pt-BR` sem entrada correspondente em `es`/`en-US`.

### Causa raiz
Strings foram adicionadas diretamente no código/HTML durante desenvolvimento rápido, sem passar
por `t()` + entrada em `js/i18n.js`. Exemplos reais confirmados: labels do countdown
("dias/hrs/min/seg" fixos em PT-BR independente do idioma — `B-03` em `BUGS_AND_FEEDBACK.md`,
ainda aberto); "Emp" (empate) hardcoded em vez de `t("probDrawShort")`; mensagens de sync ESPN
("Nenhum resultado knockout encontrado", "Jogo encerrado!", etc.) hardcoded em PT antes da
auditoria `v4.109`.

### Como foi corrigido
Cada ocorrência encontrada foi movida para `js/i18n.js` nos três idiomas (`pt-BR`, `es`,
`en-US`) e substituída por `t("chave")` no código. A auditoria `v4.109` corrigiu de uma vez
várias strings hardcoded encontradas na mesma varredura.

### Como evitar novamente
- **Toda** string nova visível ao usuário deve nascer como chave em `js/i18n.js`, adicionada
  **nos três idiomas simultaneamente** (mesmo que a tradução es/en seja provisória) — nunca
  como texto literal no JS/HTML.
- BR2026/CDB2026 têm cobertura parcial por decisão consciente (só `pt-BR` implementado, ES/EN
  desabilitados na UI) — isso é intencional, documentado em `CONSISTENCY_MATRIX.md` item 32-33,
  e diferente do bug de strings hardcoded dentro do idioma ativo.
- Verificação de QA: `docs/bolao/QA_MASTER_CHECKLIST.md` seção B já cobre isso ("Nenhuma chave
  de i18n usada em `t()`/`data-i18n` sem entrada correspondente nos três objetos de idioma") —
  rodar essa checagem antes de qualquer PR que toque texto visível.
- `B-03` (countdown hardcoded em PT-BR) segue **aberto** na Copa até hoje — candidato óbvio para
  quem for mexer no countdown por outro motivo.

---

## Admin hash / lockout — divergência de mecanismo

### Problema
A documentação (`SECURITY.md`, `ARCHITECTURE.md`) descreve o lockout de admin (5 tentativas →
15 min) como armazenado em `localStorage`, mas o código real usa `sessionStorage`.

### Causa raiz
A documentação não foi atualizada quando o mecanismo de armazenamento do lockout mudou de
`localStorage` para `sessionStorage` em algum ponto da evolução do código — divergência
documentação-vs-código, não um bug funcional (o mecanismo em si funciona).

### Como foi corrigido
Ainda **não corrigido** — identificado e registrado como pendência em `CONSISTENCY_MATRIX.md`
item 3 durante a auditoria de governança de 2026-07-12. Fora do escopo daquela tarefa
(auditoria, sem alteração de código/doc fora do bloco automático).

### Como evitar novamente
- Sempre que mudar o mecanismo de storage de qualquer feature de segurança (lockout, sessão),
  atualizar `SECURITY.md` no mesmo PR — não deixar para depois.
- Ao documentar um mecanismo de segurança, referenciar a chave literal usada no código
  (`sessionStorage["adminLockUntil"]`) em vez de descrever só o conceito — torna a divergência
  fácil de flagrar em auditoria futura.
- Corrigir esta divergência específica é uma tarefa pendente de baixo risco (`Medium`
  severidade, é só documentação) que qualquer sessão futura pode resolver.

---

## Senha hardcoded / texto puro no código

### Problema
Em versões antigas (pré-v3.0), havia um comentário no código-fonte com a senha admin em texto
puro, e um hash alternativo de fallback coexistindo com o hash principal (ambos aceitos no
login).

### Causa raiz
Prática de desenvolvimento inicial deixou um comentário de referência ("a senha atual é X") no
código para facilitar debug, e um segundo hash foi deixado como fallback "por segurança" durante
uma transição de senha, sem removê-lo depois.

### Como foi corrigido
Ambos removidos em **v3.0**: nenhuma senha em texto puro em nenhum lugar (source, HTML,
comentário, `localStorage`); apenas um único `adminPasswordHash` (SHA-256) é aceito, sem
fallback alternativo. Se `adminPasswordHash` estiver vazio/ausente, o login admin é bloqueado
por completo (nunca "aberto por padrão").

### Como evitar novamente
- Nunca escrever a senha em texto puro em nenhum lugar do repositório, nem em comentário "só
  para referência" — comentários são commitados e ficam no histórico do git para sempre.
- Nunca manter dois hashes válidos simultaneamente "por segurança" — um único
  `adminPasswordHash` é a única fonte de verdade; trocar de senha significa substituir o hash,
  não adicionar um segundo.
- `docs/bolao/QA_MASTER_CHECKLIST.md` seção B já bloqueia isso: "Nenhum segredo... Nenhuma
  senha em texto puro — admin password é sempre hash SHA-256".
- Os três apps hoje compartilham o **mesmo** hash de senha admin — risco aceito e documentado
  (`CONSISTENCY_MATRIX.md` item 2), não uma regressão deste bug, mas vale considerar hashes
  distintos por app antes de publicar BR2026/CDB2026.

---

## Event listeners duplicados

### Problema
Duas classes de bug relacionadas a event handling: (1) ações de admin (pagamento, resultado)
tinham um listener por elemento em vez de delegação, causando comportamento inconsistente ao
re-renderizar; (2) um botão usava `onclick` inline, que o CSP bloqueia silenciosamente.

### Causa raiz
1. Pré-v3.0: cada linha da tabela de admin tinha seu próprio `addEventListener` anexado
   individualmente. A cada re-render, novos listeners eram anexados aos novos elementos DOM
   (o que por si só não duplica, já que o DOM antigo é destruído) — mas o padrão era frágil e
   nada garantia que um elemento não acabasse com handlers acumulados se o re-render não
   recriasse o nó inteiro.
2. O banner "jogo encerrado" tinha um botão com `onclick="showSection('admin')"` inline. Isso é
   bloqueado pelo CSP (`script-src` sem `'unsafe-inline'`) — o clique simplesmente não fazia
   nada, e além disso a função `showSection` está dentro da IIFE, não é acessível no escopo
   global de um atributo `onclick` de qualquer forma.

### Como foi corrigido
1. Migrado para **um único** `document.addEventListener("click", ...)` e
   `document.addEventListener("change", ...)` no nível do `document`, usando
   `e.target.closest(seletor)` para delegação — corrigido em v3.0. Esse é o padrão usado em
   toda a aplicação desde então (documentado em `ARCHITECTURE.md`: "Single ... handle all
   interactions via ... delegation. No inline `onclick` handlers.").
2. O botão do banner foi migrado para `data-banner-nav="admin"`, tratado pelo delegation
   handler existente.

### Como evitar novamente
- **Nunca usar `onclick`/`onchange` inline no HTML** — sempre `data-*` attribute + handler
  delegado no `document`. Isso também é exigido pelo CSP atual (`script-src` sem
  `'unsafe-inline'`), então um `onclick` inline simplesmente não funciona, silenciosamente.
- Preferir sempre um único listener delegado por tipo de evento no nível do `document` a
  vários listeners por elemento — elimina a classe inteira de bug de "listener duplicado" ou
  "listener órfão apontando para um nó DOM que já foi substituído".
- `QA_MASTER_CHECKLIST.md` seção B já cobre isso: "Nenhum listener de evento duplicado".

---

## Ranking — posição divergente da ordem visual / desempate

### Problema
Duas classes de bug no ranking: (1) o número "Pos." (posição no ranking geral provisório) e a
ordem visual das linhas da tabela de pontos ao vivo por partida usavam critérios de desempate
diferentes, então uma linha rotulada "3" podia aparecer acima de uma linha rotulada "2"; (2)
confusão de participantes com mudanças de posição que na verdade eram legítimas (resultado
novo chegando), mas que expuseram a necessidade de uma auditoria formal.

### Causa raiz
1. O número de posição exibido vinha de uma função de cálculo de ranking geral; a ordem visual
   das linhas vinha de uma ordenação separada só pelos pontos daquela partida específica — as
   duas não usavam o mesmo comparador em caso de empate.
2. Não havia processo formal de "explicar uma mudança de posição para o participante" nem
   auditoria cruzada entre site e e-mail antes do incidente de julho de 2026.

### Como foi corrigido
1. Corrigido em **v4.52**: ambos os lugares passaram a usar o **mesmo comparador**, as linhas
   ordenam diretamente pelo `provPos` (posição provisória) exibido ao usuário — não há mais
   dois cálculos independentes.
2. Auditoria completa (ver `PROJECT_MEMORY.md` → "Auditorias realizadas") + regra permanente de
   rodar `audit_scoring.py` após qualquer mudança.

### Como evitar novamente
- Sempre que dois lugares da UI precisarem mostrar "a mesma noção de posição/ordem", eles devem
  consumir o **mesmo valor calculado**, nunca reimplementar o comparador de desempate duas
  vezes.
- Ver também a seção "Bônus" abaixo — a mesma classe de bug (duas implementações da mesma regra
  divergindo) se repetiu na fórmula de pontuação entre `app.js` e `send_result_email.py`.

---

## Bônus (campeão/vice/3º/4º) não somado corretamente

### Problema
O e-mail automático de resultado mostrava um total de pontos **menor** do que o real para
entradas que acertaram palpites de pódio, e o bônus de 4º lugar nunca era concedido a ninguém,
mesmo quando merecido.

### Causa raiz
No script Python (`send_result_email.py`), os pontos de bônus (campeão +25, vice +15, 3º +10,
4º +5) eram calculados **apenas como critério de desempate**, nunca somados ao total de pontos
exibido — diferente do site, onde `scoreEntry()` já soma esses pontos ao total. Além disso, duas
funções internas calculavam a variável "4º lugar" mas **não a incluíam no dicionário
retornado**, então o bônus de +5 nunca conseguia ser concedido a ninguém, mesmo depois de
corrigir o problema de soma.

### Como foi corrigido
Ambos corrigidos em **v4.57**, junto com a correção do bracket (`MATCH_TEAMS`) que não batia
com `data.js` para 9 de 16 partidas. Verificado com uma simulação de torneio completo com
bracket "perfeito" confirmando que o total (pontos de partida + bônus) bate com o que o site
calcularia. Ver detalhes completos em `PROJECT_MEMORY.md` → "Auditorias realizadas".

### Como evitar novamente
- Qualquer lógica de pontuação que precise existir em mais de um lugar (site em JS, script em
  Python) é um risco estrutural de drift — não há como o Python importar `scoreEntry()` do
  `app.js` diretamente. A mitigação real é `audit_scoring.py`, que testa a **paridade** entre
  as duas implementações, não só a correção de cada uma isoladamente.
- Ao adicionar qualquer novo tipo de bônus/pontuação, verificar explicitamente que ele é (1)
  somado ao total, não só usado para desempate, e (2) incluído em **todo** dicionário/objeto de
  retorno que alimenta o total, não só calculado como variável local.
- Regra permanente: qualquer mudança em `data.js` (bracket), na fórmula de scoring/bônus em
  `config.js`, ou em `send_result_email.py` exige rodar `audit_scoring.py` e tratar falha como
  bloqueador antes de abrir PR (`CLAUDE.md`).

---

## Popup blockers

### Problema
O comprovante (`openReceipt`) abre em uma nova aba via `window.open(blobUrl)` — bloqueadores de
popup podem impedir essa abertura silenciosamente.

### Causa raiz
Comportamento padrão de navegador (não é um bug de código): `window.open` fora de um gesto
direto do usuário, ou dependendo da configuração do navegador, pode ser bloqueado.

### Como foi corrigido
Não há como "corrigir" o bloqueio em si — a mitigação foi adicionar um caminho alternativo que
não depende de popup: "Download HTML" baixa o arquivo do comprovante diretamente
(`downloadReceipt`), sem `window.open`. Um `alert()` explicativo é mostrado se o popup falhar
(um dos poucos casos em que `alert()` bloqueante foi mantido deliberadamente, em vez de
convertido para toast).

### Como evitar novamente
- Nunca fazer de um popup o **único** caminho para uma ação importante (comprovante, recibo,
  export) — sempre oferecer um fallback que não dependa de `window.open` tendo sucesso.
- `docs/bolao/QA_CHECKLIST.md` já cobre isso explicitamente: "Receipt popup gracefully handles
  browser popup blocker (fallback download shown)" — testar isso a cada release que toque o
  fluxo de comprovante.

---

## Supabase — merge/sync

### Problema
Múltiplos bugs de sincronização ao longo do tempo: (1) entradas de participantes "sumindo" do
ranking; (2) entradas deletadas "ressuscitando"; (3) resultados corretos no Supabase sendo
sobrescritos por dado antigo do `localStorage` local.

### Causa raiz
1. `loadRemoteState` ignorava entradas do Supabase quando o timestamp local era mais recente
   (ex.: admin salvou algo depois do participante) — a lógica tratava "mais recente" como
   "vence", quando o correto para `entries` é sempre união, nunca descarte por timestamp.
2. `mergeStates` fazia união **aditiva pura**: nunca removia entradas, só adicionava. Se o
   Supabase ainda tinha uma entrada que o admin havia deletado localmente, qualquer sync
   posterior (foco de aba, `visibilitychange`) trazia a entrada deletada de volta — não havia
   conceito de "isso foi removido de propósito" no protocolo de merge.
3. O merge de `results` originalmente dava preferência ao valor **local** em caso de conflito
   de chave — então um `localStorage` de teste desatualizado em outro dispositivo (ex.: alguém
   que testou o ESPN sync antes do jogo começar de verdade) podia sobrescrever um resultado
   correto e mais recente vindo do Supabase.

### Como foi corrigido
1. Merge sempre acontece em `loadRemoteState` — `entries` são sempre união (com tombstones),
   nunca descartadas por comparação de timestamp (**v4.10**).
2. Introduzido o conceito de **tombstones**: `state.deletedIds[]`. IDs deletados são
   propagados no merge e filtram entradas tanto no lado local quanto no remoto. `deleteEntry`
   passou a salvar imediatamente (`forceResults: true`), sem o debounce de 400ms, eliminando a
   janela de corrida (**v4.9**).
3. `mergeStates` mudou a regra de `results` para dar preferência ao **remoto** (**v4.1-patch**,
   reforçado em **v4.108** com a flag explícita `preferRemoteResults: true` usada por
   `loadRemoteState`) — o Supabase (fonte de verdade administrada) sempre vence, nunca o
   `localStorage` local.

### Como evitar novamente
- Merge "aditivo puro" (união que nunca remove) é incompatível com qualquer feature de deleção
  — sempre que existir uma ação destrutiva sincronizada, o protocolo de merge precisa de
  tombstones, não só de união.
- Ao decidir a regra de merge de um campo, perguntar explicitamente "quem é a fonte de verdade
  para este campo especificamente" — a resposta pode (e deve) ser diferente por campo:
  `entries` → união com tombstones; `paid` → any-true-wins; `results` → remote-wins. Não existe
  uma regra única de merge que sirva para todos os campos do mesmo objeto de estado.
- Ações administrativas que alteram estado compartilhado devem gravar de forma **imediata**
  (sem debounce) — o debounce é apropriado só para rascunho/digitação do participante, nunca
  para uma escrita que precisa vencer uma corrida com outro dispositivo.

---

## Multi-tab / múltiplas abas ou dispositivos

### Problema
Um dispositivo/aba mostrando dado obsoleto (entradas antigas, resultados desatualizados) mesmo
depois de outro dispositivo já ter atualizado o Supabase.

### Causa raiz
Combinação de causas já descritas em "Supabase — merge/sync" (regra de merge incorreta) mais
duas causas específicas de multi-aba/dispositivo:
1. Sync só acontecia em `focus`/`visibilitychange` — sem Supabase Realtime, não há push
   instantâneo entre abas abertas simultaneamente.
2. **iOS Safari especificamente**: o WebKit pode restaurar uma página do **bfcache** (back-
   forward cache) ao voltar para uma aba em segundo plano **sem disparar `visibilitychange` de
   forma confiável** — bug conhecido do WebKit, não do app. A página ficava presa no estado em
   memória do último carregamento real, sem nunca refazer o sync.

### Como foi corrigido
1. Regras de merge corrigidas (ver seção anterior).
2. Listener em `pageshow` com checagem de `event.persisted`, forçando um resync sempre que o
   WebKit restaura a página do bfcache — cobre o caso que `visibilitychange` sozinho não pega
   (**v4.111**).
3. Intervalo de sync automático reduzido de 90s → 30s; a aba Ranking dispara
   `debouncedReload()` sempre que é aberta, garantindo dado fresco ao visualizar (**v4.108**).

### Como evitar novamente
- Em qualquer app que sincroniza estado entre abas/dispositivos sem WebSocket/Realtime, nunca
  confiar só em `visibilitychange` — especialmente em iOS Safari. Adicionar também um listener
  de `pageshow`/`event.persisted` para cobrir bfcache.
- BR2026/CDB2026 hoje só têm `visibilitychange` (sem `focus` nem `pageshow`) — gap conhecido,
  catalogado como `NEEDS_REVIEW` em `CONSISTENCY_MATRIX.md` item 23.
- Testar qualquer mudança de sync especificamente em Safari/iOS real (ou simulação de bfcache),
  não só em Chrome desktop — essa classe de bug não aparece em Chrome.

---

## Clear Data (Limpar dados)

### Problema
Não há um bug histórico documentado de "Limpar dados" apagando algo indevidamente — o risco
real é estrutural: a ação é destrutiva (limpa `localStorage` **e** Supabase) e, nos dois apps
novos, nem sequer existe uma versão na UI.

### Causa raiz / situação atual
- Na Copa, "Limpar tudo" existe (`clearData`, classe `danger`) com confirmação dupla
  (`confirm()` mantido deliberadamente bloqueante para ações destrutivas — ver
  `PROJECT_MEMORY.md` → "Decisões arquiteturais").
- Em BR2026/CDB2026, **não existe** botão equivalente na UI admin — só é possível limpar dados
  via edição direta no Supabase. Catalogado como `MISSING`/severidade `Medium` em
  `CONSISTENCY_MATRIX.md` item 7.

### Como evitar problemas futuros
- Qualquer ação de "limpar dados" deve manter `confirm()` bloqueante (nunca virar toast) — é
  uma das duas exceções deliberadas à migração para toasts não-bloqueantes feita no app (a
  outra é validação de formulário).
- Antes de publicar BR2026/CDB2026, decidir explicitamente se um botão "Limpar dados" será
  adicionado à UI ou se o procedimento manual via Supabase (já documentado para a Copa em
  `ARCHITECTURE.md` → "Admin emergency procedures") será a via oficial — e documentar a decisão,
  não deixar como omissão silenciosa.
- Qualquer ação destrutiva nova deve limpar **local e remoto juntos**, nunca só um dos dois —
  limpar só o local deixaria o Supabase re-popular o estado "limpo" no próximo sync.

---

## API Football

### Problema
Nenhum incidente de produção documentado (a feature está desabilitada por padrão), mas há
limitações estruturais conhecidas relevantes para quem for habilitá-la.

### Causa raiz / situação atual
- A chave de API, se configurada, fica **visível no código-fonte do browser** — inerente a um
  app 100% frontend sem proxy.
- Matching de partidas da API para o bracket é por normalização de nome de time + data — nomes
  divergentes (fuzzy match) podem causar partidas puladas silenciosamente (só um
  `console.warn`, não um erro visível na UI).
- Free tier: 100 requisições/dia; a 5 min de polling (só quando o admin está logado e a aba
  visível) isso raramente é excedido, mas é um limite real.
- **Nunca sobrescreve um resultado inserido manualmente** — essa é uma proteção deliberada, não
  um bug.

### Como evitar problemas futuros
- Antes de habilitar em produção com um plano pago, implementar o proxy recomendado (Supabase
  Edge Function) — há um `TODO` explícito em `bolao/js/app.js:3001` marcando esse ponto
  exatamente.
- Ao investigar "por que essa partida não atualizou sozinha", checar primeiro o `console.warn`
  de mismatch de nome antes de assumir que é um bug de lógica — a causa mais comum é
  divergência de nome de time entre a API e `data.js`.
- BR2026 usa ESPN (não API-Football) para standings/scoreboard, com poll de 60s sem cache
  persistido — estratégia diferente por natureza da fonte, não uma inconsistência a corrigir.

---

## Countdown / timer

### Problema
Várias iterações de bug real ao longo do tempo: (1) o countdown de prazos futuros (Oitavas,
Quartas, etc.) ficava **invisível** porque estava dentro de um container com
`display:none` permanente; (2) o número mudava de largura a cada segundo (jitter visual) porque
horas/minutos não tinham padding de dígito fixo; (3) no card "Próximo jogo" mobile, o
cronômetro de 3 células herdava uma regra CSS pensada para o countdown principal de 4 células,
quebrando o layout.

### Causa raiz
1. `#heroCard { display: none }` era uma regra CSS permanente que escondia todo o conteúdo,
   incluindo o countdown — a lógica de `updateCountdown()` funcionava corretamente, mas nunca
   tinha onde aparecer.
2. Horas/minutos eram renderizados sem `padStart("0")`, então "9" e "10" tinham larguras
   diferentes, fazendo a caixa do countdown mudar de tamanho a cada tick.
3. Uma media query `max-width:500px` genérica (`.count-grid { grid-template-columns: repeat(2,
   1fr) }`), pensada para o countdown principal de 4 células (dias/hrs/min/seg), também
   capturava o cronômetro de 3 células (hrs/min/seg) do card "Próximo jogo" por reuso acidental
   de classe/seletor.

### Como foi corrigido
1. `updateCountdown()` passou a usar `#reopenBanner` (fora do container escondido) para exibir
   o countdown sempre que `cutoffIso` for futuro, escondendo o banner só quando o prazo já
   passou — desacoplado do `display:none` do hero.
2. `padStart("0")` em horas/minutos + `font-variant-numeric: tabular-nums` + `min-width: 2ch`
   nos dígitos — a caixa não muda mais de largura por segundo.
3. Override CSS específico para `.next-match-timer` restaurando 3/4 colunas, em vez de herdar a
   regra genérica de 2 colunas.

### Como evitar novamente
- Nunca esconder um container inteiro via `display:none` sem confirmar que nenhum
  sub-componente com lógica ativa (timer, polling) depende de estar visível/presente no layout
  — separar "esconder conteúdo" de "esconder o timer que só por acaso mora dentro desse
  container".
- Números que mudam a cada tick (segundos, minutos) devem sempre ter largura fixa
  (`padStart`/`tabular-nums`/`min-width`) para evitar jitter de layout.
- Media queries genéricas por classe (`.count-grid`) são arriscadas quando reusadas por
  componentes com número de células diferente — preferir um seletor mais específico
  (`.next-match-timer`) para overrides de layout que dependem do número de itens.
- `B-03` (labels do countdown hardcoded em PT-BR) segue em aberto — ver seção "Traduções
  incompletas".

---

## Mobile layout

### Problema
Várias classes recorrentes de bug mobile-only: zig-zag de bandeira/nome entre os dois times,
placeholder de placar vazio ocupando espaço grande, texto de probabilidade cortado no meio da
palavra, card empilhando em 3 blocos de altura total em vez de compactar.

### Causa raiz
- **Zig-zag de bandeira/nome**: bandeira+nome eram uma única string concatenada de texto, não
  elementos separados — quando o layout empilha em coluna única no mobile, o CSS não tem como
  reordenar bandeira-antes-do-nome para os dois times de forma consistente (no desktop isso não
  aparece porque as bandeiras ficam nas bordas externas, um efeito visual intencional que só
  funciona em grid horizontal).
- **Placeholder vazio grande**: o placeholder "×" de uma partida ainda não jogada reusava a
  mesma caixa de fonte 22px do placar real — em mobile, virava um retângulo quase vazio
  visualmente pesado.
- **Texto cortado**: labels da barra de probabilidade não tinham `word-wrap`/`overflow-wrap`
  configurado para o espaço mais estreito da divisão de 3 vias em mobile.
- **Cards empilhados em 3 blocos**: posição, nome, pontos e o botão "Ver palpites" ocupavam
  bandas de linha separadas em vez de uma linha compacta — nenhuma regra mobile-specific
  existia para compactar o card do ranking.

### Como foi corrigido
Todos corrigidos com CSS mobile-only, **sem alterar HTML/dado/estrutura**:
- Bandeira e nome separados em `<span>`s distintos (mesmo padrão já usado no card ao vivo),
  permitindo que o mobile mostre "bandeira primeiro" para os dois times de forma consistente,
  mantendo o desktop pixel-idêntico (**v4.86**).
- Placeholder de placar vazio reduzido a texto pequeno simples só em mobile.
- `word-wrap` nas labels da barra de probabilidade.
- Card do ranking recompactado em 2 linhas e depois em **1 linha só** — a chave para não
  desalinhar o botão "Ver palpites" foi dar à coluna de pontos uma **largura fixa** em vez de
  largura por conteúdo, então o botão sempre começa na mesma posição X independente do placar
  ter 1, 2 ou 3 dígitos (**v4.100**/depois).

### Como evitar novamente
- Ao criar qualquer par "ícone/bandeira + texto" que precise reordenar por breakpoint, sempre
  usar elementos HTML separados — nunca concatenar em uma única string de texto.
- Elementos numéricos ao lado de um botão de largura variável (placar, contador) devem ter
  largura fixa reservada, não largura por conteúdo, para não deslocar elementos vizinhos.
- Testar mudanças de mobile layout com pelo menos um caso de "nome de time muito longo" (ex.:
  "Bosnia and Herzegovina") como stress test — várias correções aqui foram verificadas
  especificamente com esse caso.
- BR2026/CDB2026 tinham a mesma classe de bug no formulário de palpites e no painel de
  resultado do admin — ao corrigir um problema de mobile layout na Copa, checar se o mesmo
  padrão de markup existe nos outros dois apps antes de considerar a tarefa concluída (regra de
  propagação de `PLATFORM_GOVERNANCE.md`).

---

## Safari

### Problema
Três bugs específicos de Safari/WebKit (iOS), não reproduzíveis em Chrome: (1) checkbox de
pagamento perdendo cliques em containers roláveis; (2) cache HTTP agressivo servindo
`index.html` desatualizado mesmo com service worker "network-first"; (3) bfcache restaurando
página sem disparar `visibilitychange`.

### Causa raiz
1. iOS Safari tem uma inconsistência conhecida: eventos `change` em checkboxes dentro de
   elementos `<label>`, dentro de um container rolável, podem ser "engolidos" (não disparam de
   forma confiável).
2. A estratégia "network-first" do `sw.js` fazia só `fetch(e.request)` — que **ainda consulta o
   cache HTTP do próprio navegador** antes de ir à rede. Safari no iOS (e alguns proxies de
   operadora) cacheiam de forma mais agressiva que desktop, então mesmo com o service worker
   "certo", o navegador podia devolver um `index.html` cacheado e antigo.
3. Ver detalhes em "Multi-tab" acima — bug de bfcache do WebKit.

### Como foi corrigido
1. Substituído checkbox+`change` por botão+`click` (`click` em `<button>` é universalmente
   confiável) — **v4.8**.
2. `fetch(e.request, { cache: 'no-store' })` no service worker, forçando ida real à rede;
   versão do cache do SW incrementada (`bolao-sw-v1` → `v2`) para descartar entradas antigas —
   **v4.111**.
3. Listener `pageshow` com `event.persisted` — **v4.111**.

### Como evitar novamente
- **Testar em Safari/iOS real (ou emulado) é obrigatório**, não opcional — as três classes de
  bug acima simplesmente não existem em Chrome e não teriam sido pegas testando só nele.
  `QA_MASTER_CHECKLIST.md` seção D já exige "Testado em Safari" explicitamente.
- Para qualquer interação crítica (pagamento, ação destrutiva) dentro de um container rolável,
  preferir `click` em `<button>` a `change` em `<input type=checkbox>`.
- Ao mexer em `sw.js` ou em qualquer estratégia de cache, lembrar que "network-first" no código
  do service worker não é suficiente sozinho — o `fetch` interno também precisa de
  `{ cache: 'no-store' }` para de fato ignorar o cache HTTP do navegador.

---

## Receipts (comprovantes)

### Problema
O código do comprovante (`BOLAO-XXXXXXXX-YYYYMMDD`) podia, em tese, mudar se a entrada fosse
editada depois de criada — o que quebraria a garantia de que o código identifica de forma
estável aquela entrada específica.

### Causa raiz
`saveEntry()` em modo de edição confiava em um spread implícito do objeto da entrada, sem
declarar explicitamente `entryName` e `createdAt` — os dois campos dos quais o `receiptCode`
depende (hash FNV-32 de `entryName + createdAt`). Qualquer alteração futura nesse bloco de
código poderia, por acidente, deixar um desses campos mudar durante uma edição, quebrando o
código do comprovante sem intenção.

### Como foi corrigido
`saveEntry()` em modo de edição passou a declarar `entryName` e `createdAt` **explicitamente**
a partir de `_editingEntry`, em vez de depender de um spread implícito — torna a garantia
robusta a mudanças futuras no mesmo bloco.

### Como evitar novamente
- Campos que alimentam um identificador estável e publicamente visível (como um código de
  comprovante) devem ser atribuídos de forma **explícita**, nunca via spread genérico de objeto
  — um spread implícito é fácil de quebrar sem perceber ao editar código próximo.
- BR2026/CDB2026 não têm sistema de comprovante ainda — ao implementar, replicar o padrão de
  hash determinístico (FNV-32, não criptográfico, usado só para identificação) e a mesma
  atribuição explícita de campos-fonte.

---

## Backup

### Problema
Não há um incidente único documentado de perda de backup — o padrão relevante é estrutural: a
Copa tem múltiplos mecanismos de backup (Backup CSV completo, Backup JSON, scripts Python
`backup.py`/`backup_daily.py`/`backup_watch_m88.py`), enquanto BR2026/CDB2026 não têm nenhum
export de backup JSON na UI admin.

### Causa raiz / situação atual
BR2026/CDB2026 foram construídos reaproveitando o design system da Copa, mas sem replicar as
ferramentas administrativas avançadas (incluindo backup) — catalogado como `MISSING`/severidade
`Medium` em `CONSISTENCY_MATRIX.md` item 16, explicitamente citado como "é a rede de segurança
citada no disclaimer" desses apps.

### Como evitar problemas futuros
- Antes de publicar qualquer um dos dois apps novos, adicionar no mínimo um export de "Backup
  JSON" (estado completo) na UI admin — é a rede de segurança mínima para um app que já
  movimenta dinheiro real de entrada, mesmo antes de publicado.
- Regra geral já em `SECURITY.md`: "o admin deve exportar um backup CSV após o cutoff fechar" —
  essa recomendação vale para os três apps, não só a Copa.
- Procedimento de emergência "exportar todos os dados sem o app" via Supabase direto já está
  documentado em `ARCHITECTURE.md` para a Copa — vale replicar a mesma seção para BR2026/CDB2026
  quando publicados.

---

## Símbolo do time — `<img>` sem `width`/`height` renderiza em tamanho nativo

### Problema
Escudo do time no BR2026 renderizava gigante (bem maior que o resto da UI) nos cards "Ao
vivo" e "Próximo jogo", logo depois de um fix que adicionava o escudo a esses dois widgets
(que antes só mostravam o nome do time em texto puro).

### Causa raiz
O helper `teamLogoImg(team, cls)` gera `<img src=... class="${cls}">` sem nenhum atributo
`width`/`height` inline. Os usos antigos da mesma classe (`.team-logo`, dentro das barras de
probabilidade) sempre tiveram `width="14" height="14"` como atributo HTML direto no `<img>` —
o que mascarava o fato de a própria classe `.team-logo` no CSS nunca ter tido essas dimensões
definidas. Assim que o helper passou a ser usado em lugares novos sem esse atributo inline, o
navegador renderizou a imagem no tamanho nativo do arquivo (bem maior que 14px).

### Como foi corrigido
Adicionado `width:14px; height:14px` diretamente à classe `.team-logo` no CSS (`v1.15`) — cobre
todos os usos, presentes e futuros, sem depender de lembrar o atributo inline toda vez que o
helper for chamado em um novo lugar.

### Como evitar novamente
- Sempre que um componente visual (ícone, escudo, logo) tiver uma classe CSS dedicada, o
  **tamanho deve estar na classe**, nunca só em atributo HTML inline espalhado pelos call
  sites — um único lugar esquecido quebra visualmente sem erro nenhum no console.
- Ao criar um helper que gera `<img>` dinamicamente (como `teamLogoImg()`), testar
  visualmente em pelo menos um lugar novo antes de considerar o padrão "reaproveitado com
  segurança" — o código roda sem erro dos dois jeitos, só o resultado visual denuncia o bug.
- Regra permanente adicionada a `CLAUDE.md`: toda alteração de componente visual exige
  localizar todas as ocorrências, comparar visualmente, e corrigir todas — não só o lugar
  onde o bug foi reportado.

---

## LocalStorage — dado obsoleto/corrompido

### Problema
Dispositivo mostrando dado obsoleto mesmo após atualização, ou app quebrando (tela branca/erro
JS) por `localStorage` corrompido.

### Causa raiz
Ver "Supabase — merge/sync" e "Multi-tab" acima — a causa raiz é sempre a mesma classe de
problema: `localStorage` é local-first por design, então qualquer suposição errada sobre "quem
vence em caso de conflito" ou qualquer JSON malformado nele trava a leitura de estado no boot.

### Como foi corrigido
Procedimento de recuperação documentado e estável desde v4.0: `localStorage.removeItem
("bolao_copa_2026_state"); location.reload();` — o app reconstrói o estado do zero e imediatamente
busca o Supabase via `loadRemoteState()`. Nenhum dado é perdido desde que o Supabase esteja
íntegro, porque o `localStorage` nunca é a única cópia autoritativa de `results` (remote-wins) e
`entries` (união com tombstones).

### Como evitar novamente
- Nunca tratar `localStorage` como fonte de verdade única para dado que também existe no
  Supabase — o design local-first só é seguro porque o merge tem regras de precedência
  explícitas por campo (ver "Supabase — merge/sync").
- Ao debugar "app não carrega"/"tela branca", `localStorage.removeItem(...)` + reload é o
  primeiro passo de diagnóstico documentado, não um último recurso — está em
  `ARCHITECTURE.md` → "Recover from corrupted localStorage".

---

## Consistency (consistência entre os três apps)

### Problema
Bugs já corrigidos na Copa reaparecendo em BR2026/CDB2026 porque os três apps não compartilham
código — cada correção precisa ser propagada manualmente, e nem sempre é.

### Causa raiz
Decisão arquitetural deliberada: os três apps são independentes (sem imports/módulos
compartilhados) para que uma mudança arriscada em um app novo nunca afete automaticamente a
Copa, que já tem dinheiro real em jogo. O preço dessa decisão é que o inverso também é
verdadeiro — uma correção boa na Copa não se propaga automaticamente para os apps novos.
Exemplo real e catalogado: o bug de CSV `\n` vs `\r\n` (ver seção "CSV" acima), corrigido na
Copa em v3.0, está **presente novamente** em BR2026 e CDB2026.

### Como foi corrigido
Não é um bug único e pontual — é um padrão estrutural, mitigado por processo:
`docs/bolao/PLATFORM_GOVERNANCE.md` (regra de propagação obrigatória) e
`docs/bolao/CONSISTENCY_MATRIX.md` (auditoria área-por-área, hoje com 60 itens comparados,
recatalogando exatamente essa classe de regressão).

### Como evitar novamente
- **Regra de propagação obrigatória** (já em `CLAUDE.md`/`PLATFORM_GOVERNANCE.md`): qualquer
  alteração visual, de componente, acessibilidade, segurança, banco, e-mail, receipt, admin ou
  infraestrutura feita em um app deve ser auditada nos demais antes de encerrar a tarefa.
- Ao corrigir qualquer bug em um dos três apps, perguntar explicitamente "esse mesmo bug existe
  nos outros dois?" antes de considerar a tarefa concluída — não assumir que não existe só
  porque não foi reportado lá.
- Quando uma correção não for propagada, o motivo deve ser registrado no changelog do app e, se
  for uma decisão de plataforma, também em `CONSISTENCY_MATRIX.md`.

---

## QA

### Problema
Vários bugs reais só foram pegos depois de deploy (produção), não durante QA manual — em
particular, o bug de "reload loop infinito" (`v4.109`) afetava **todos os visitantes** e só foi
encontrado numa auditoria específica, não no fluxo normal de QA.

### Causa raiz
QA manual, feito por uma única pessoa (Eduardo) testando o fluxo feliz + alguns casos de borda
conhecidos, não cobre sistematicamente: estados de erro silenciosos (`ReferenceError` dentro de
uma função de render), condições de corrida (debounce vs. backgrounding mobile), ou
comportamento específico de Safari/iOS quando o teste é feito majoritariamente em Chrome/mobile
Android.

### Como foi corrigido
Formalização progressiva de processo:
1. `docs/bolao/QA_CHECKLIST.md` — checklist funcional específico da Copa, incluindo uma seção
   dedicada "Scoring/ranking parity — run before ANY PR, always, no exceptions" desde o
   incidente de julho de 2026.
2. `bolao/scripts/audit_scoring.py` — auditoria automatizada que roda antes de qualquer e-mail
   automático e é exigida após qualquer mudança no repositório.
3. `docs/bolao/QA_MASTER_CHECKLIST.md` — checklist cross-app (pre-change, static checks,
   funcional, visual, cross-app, post-change) para mudanças `PLATFORM_SHARED`, `SECURITY` ou
   `EMERGENCY_HOTFIX`.
4. Uso de testes automatizados (Playwright) para reproduzir cenários específicos (relógio ao
   vivo, payloads malformados, mobile breakpoints) antes de considerar uma correção verificada
   — citado repetidamente no changelog como parte do processo de correção, não só de
   desenvolvimento inicial.

### Como evitar novamente
- QA manual sozinho não é suficiente para esta plataforma — sempre que possível, reproduzir o
  bug relatado com um teste automatizado (Playwright ou equivalente) antes de declarar a
  correção verificada, especialmente para bugs de timing/estado (relógio, sync, race
  condition).
- Rodar `python3 bolao/scripts/audit_scoring.py` e reportar o resultado é **obrigatório** após
  qualquer mudança no repositório, relacionada a scoring ou não — dois dos bugs mais graves já
  encontrados (bônus não somado, 4º lugar descartado) estavam em código que ninguém suspeitava
  ser "relacionado a scoring" no momento em que foi escrito.
- Testar explicitamente em Safari/iOS, não só Chrome — várias classes de bug (ver seção
  "Safari") só existem lá.
- Ao publicar BR2026/CDB2026, rodar `docs/bolao/QA_MASTER_CHECKLIST.md` inteiro (não só o
  checklist funcional básico) antes de considerar o app pronto — a Copa só chegou ao nível
  atual de estabilidade depois de várias rodadas de auditoria formal, não deploy único.
