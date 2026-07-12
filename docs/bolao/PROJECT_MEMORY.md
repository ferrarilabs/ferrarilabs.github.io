# Project Memory — Plataforma Bolão

Este documento é a memória permanente do projeto. Ele existe para que qualquer IA ou pessoa
que retome o trabalho aqui não precise reconstruir o contexto do zero. Todo o conteúdo abaixo
foi extraído da documentação existente (`docs/bolao/*.md`, `bolao/docs/*.md`, `CLAUDE.md`,
changelogs) e do código-fonte real. Nada aqui é especulação.

Ver também: `docs/bolao/LESSONS_LEARNED.md` (bugs históricos em formato causa-raiz/correção/
prevenção), `docs/bolao/PLATFORM_GOVERNANCE.md` (regras de governança) e
`docs/bolao/CONSISTENCY_MATRIX.md` (auditoria comparativa entre os três apps).

---

## História do projeto

O projeto nasceu como um bolão informal de apostas entre amigos/família para a Copa do Mundo
2026 ("Bolão do Ferrari"), criado e mantido por Eduardo Ferrari. A versão original evoluiu por
uma sequência de patches incrementais (v2.x → v3.0 → v3.2.1 → v3.3 → v3.3.1 → v3.3.4) até que,
em **2026-06-27**, o projeto passou por um **rebuild completo do zero**, batizado
`v4.0-clean` — nenhum código do v3.x foi reaproveitado. A pasta do app também foi renomeada de
`bolao-teste/` para `bolao/` em v4.44 (2026-07, por uma sessão concorrente).

A partir de v4.0-clean, o desenvolvimento passou a ser guiado por um ciclo de feedback direto
com Eduardo (majoritariamente via WhatsApp, com screenshots de bugs reais e de referências
visuais como o placar ao vivo do Google) e por sessões de Claude Code operando diretamente no
repositório. O app da Copa chegou à versão **v4.125** (ver `bolao/js/config.js`), com mais de
120 iterações registradas em `bolao/CHANGELOG.md`.

Em julho de 2026, a plataforma cresceu de um app único para **três aplicativos bolão
independentes**:

1. **Copa do Mundo 2026** (`bolao/`) — o original, em produção, dinheiro real em jogo.
2. **Brasileirão 2026** (`bolao/br2026/`) — picks de classificação G4/Z4 com standings ao vivo
   via ESPN, criado como segundo produto reaproveitando o design system da Copa. Não publicado
   (sem link do site principal). Versão atual: `v1.13`.
3. **Copa do Brasil 2026** (`bolao/cdb2026/`) — mata-mata com times reais, terceiro produto.
   Não publicado. Versão atual: `v1.6`.

Um marco importante da história do projeto foi a **auditoria de julho de 2026**: Eduardo,
after uma participante (Aline) ficou confusa com uma mudança de posição no ranking, pediu uma
"auditoria estilo big 4" nos resultados e no ranking. A auditoria encontrou drift real entre o
site (`app.js`) e o script de e-mail automático (`send_result_email.py`) — ver seção
"Auditorias realizadas" e `docs/bolao/LESSONS_LEARNED.md`. Esse incidente gerou a regra
permanente (hoje em `CLAUDE.md`) de rodar `bolao/scripts/audit_scoring.py` após **qualquer**
mudança no repositório, relacionada a scoring ou não.

Mais recentemente (2026-07-12), o projeto entrou em uma fase de **governança de plataforma**:
criação de `PLATFORM_GOVERNANCE.md`, `CONSISTENCY_MATRIX.md` e `QA_MASTER_CHECKLIST.md` para
formalizar como mudanças devem ser classificadas, propagadas (ou não) entre os três apps, e
auditadas antes de serem consideradas concluídas.

---

## Arquitetura

- **Runtime:** site estático servido via GitHub Pages — sem servidor, sem build step, sem
  framework.
- **JS:** código ES5-compatível em uma única IIFE por app (`app.js`). Sem módulos, sem
  bundler, sem globals vazando (tudo dentro da IIFE).
- **CSS:** um arquivo único por app (`css/styles.css`), mobile-first, responsivo. Estilos
  inline são bloqueados por CSP (`style-src 'self' 'unsafe-inline'` é a única exceção, e não
  há estilo controlado por usuário).
- **Persistência:** `localStorage` (fonte primária, local-first) + Supabase (espelho remoto
  opcional). O app funciona inteiramente sem Supabase configurado.
- **Email:** EmailJS (SDK de browser via CDN) — não há backend de envio de e-mail.
- **Dados externos:** Supabase REST API, API-Football REST API (desabilitada por padrão),
  Polymarket Gamma API (uso interno no simulador, sem UI dedicada), ESPN (site/sports API não
  documentada oficialmente, usada para placares ao vivo).
- **Deploy:** push para `main` → GitHub Pages publica automaticamente. Sem CI de build (há,
  no entanto, GitHub Actions para: `sync_version.yml` — cache-busting automático — e
  `auto_results.yml`/scripts Python agendados para e-mails de resultado).

### Ordem de carregamento de scripts (comum aos três apps)

1. `@emailjs/browser@4` (CDN, síncrono)
2. `@supabase/supabase-js@2` (CDN, síncrono, com SRI/`integrity` fixado)
3. `js/config.js` → `window.BOLAO_CONFIG` (Copa) / `window.BR2026_CONFIG` / `window.CDB2026_CONFIG`
4. `js/data.js` → dados de fixtures/times
5. `js/i18n.js` → strings de UI
6. `js/app.js` (`defer`) — toda a lógica

`app.js` verifica no boot que os três globais existem; renderiza mensagem de erro se algum
estiver faltando.

### Estado (state shape) — exemplo da Copa

Chave `localStorage["bolao_copa_2026_state"]`:

```json
{
  "entries": [{ "id": "...", "entryName": "...", "picks": { "73": { "goalsA": 2, "goalsB": 1, "advanceSide": "A" } } }],
  "paid": { "<entry-id>": true },
  "results": { "73": { "goalsA": 1, "goalsB": 0, "advanceSide": "A" } },
  "deletedIds": ["<id-tombstone>"],
  "meta": { "updatedAt": "...", "version": "v4.x" }
}
```

O campo `deletedIds` (tombstones) foi adicionado em v4.9 depois de um bug real de entradas
deletadas "ressuscitando" via sync (ver `LESSONS_LEARNED.md`).

### Estratégia de merge (local-first, merge-before-save)

1. Antes de salvar remoto, busca `updated_at` e `state` do Supabase.
2. `entries`: união por `id` — nunca perde entradas, tombstones (`deletedIds`) filtram as
   removidas tanto local quanto remoto.
3. `paid`: **any-true-wins** (`local[k] || remote[k]`) — um pagamento marcado em qualquer
   dispositivo nunca é perdido.
4. `results`: **remote-wins** por padrão desde v4.1 (`preferRemoteResults` desde v4.108 reforça
   isso no `loadRemoteState`) — o admin/Supabase é a fonte de verdade, um `localStorage` de
   teste desatualizado em outro dispositivo nunca deve sobrescrever um resultado real.
5. Falha do Supabase degrada graciosamente para `localStorage` apenas (local-first).

### Funções-chave (Copa, `bolao/js/app.js`, ~4400 linhas)

| Função | Propósito |
|---|---|
| `state()` / `saveState(s)` | Ler/gravar `localStorage` + debounce de upsert Supabase (400ms, exceto ações admin que são imediatas) |
| `mergeStates(local, remote)` | União de entries + tombstones; any-true-wins em `paid`; remote-wins em `results` |
| `scoreEntry(entry, state)` | Pontuação total + bônus de uma entrada — única implementação usada em ranking, CSV, master export e e-mail manual do admin |
| `matchPoints(pick, result)` | Pontuação por partida individual, extraída de `scoreEntry` para eliminar duplicação (v4.x) |
| `finalPodiumForEntry` / `podiumFromResults` | Resolve campeão/vice/3º/4º a partir dos palpites ou dos resultados reais |
| `resolvedTeamsForEntry` | Percorre o bracket resolvendo slots "Winner Match N" |
| `receiptHtml` / `openReceipt` / `downloadReceipt` / `mailReceipt` | Geração e entrega de comprovante — sem `document.write`, via Blob URL |
| `guardAdmin()` | Verifica sessão admin válida — chamado em **toda** ação admin, não só no login |
| `adminLogin()` | Comparação de hash SHA-256, gestão de lockout |
| `renderAll()` / `renderBracket()` / `updateDynamic()` | Renderização e resolução dinâmica do bracket |

### Multi-app: tabela de equivalência de caminhos

| Propósito | Copa (`bolao/`) | BR2026 (`bolao/br2026/`) | CDB2026 (`bolao/cdb2026/`) |
|---|---|---|---|
| Config global | `window.BOLAO_CONFIG` | `window.BR2026_CONFIG` | `window.CDB2026_CONFIG` |
| i18n | pt-BR, es, en-US completos (~735 chaves) | apenas pt-BR (~145 chaves) | apenas pt-BR (~101 chaves) |
| `app.js` | ~4400 linhas | ~1700 linhas | ~830 linhas |
| Supabase `id` | `"main"` | `"br2026"` | `"cdb2026"` |
| `localStorage` key | `bolao_copa_2026_state` | `bolao_br2026_state` | `bolao_cdb2026_state` |
| Escaping XSS | `escapeHtml()` | `esc()` (equivalente) | `esc()` (equivalente) |

Os três apps **não compartilham código** (sem imports, sem módulo comum) — são cópias
independentes que seguem a mesma convenção de arquivo e o mesmo design system visual.

---

## Estrutura dos aplicativos

### Copa (`bolao/`) — em produção

- URL: `ferrarilabs.github.io/bolao/`
- Torneio: Copa do Mundo 2026 (FIFA), sede EUA/Canadá/México.
- 72 jogos de fase de grupos (12 grupos, A–L) + 32 jogos de mata-mata (73–104).
- Final: partida 104, 19 de julho de 2026, MetLife Stadium.
- Cutoff: domingo 28 de junho de 2026, 14h ET.
- Sistema completo: comprovante individual (`BOLAO-XXXXXXXX-YYYYMMDD`), e-mail ao participante
  e ao admin, CSV (master + backup completo), backup JSON, master HTML, dados demo, ESPN sync
  ao vivo (placar, relógio, probabilidade, artilheiros), API-Football (desabilitada por
  padrão), Polymarket (interno ao simulador), script Python de auditoria de scoring e de envio
  automático de e-mail de resultado.
- Toolbar admin: 13 ações (CSV completo, Master CSV, Master HTML, JSON backup, Demo,
  API-Football, ESPN sync, e-mail teste, e-mail a todos, sync remoto, limpar tudo, entre
  outras).

### BR2026 (`bolao/br2026/`) — não publicado

- URL: `ferrarilabs.github.io/bolao/br2026/` (sem link do site principal).
- Formato: picks de classificação G4/Z4 do Brasileirão 2026, com standings ao vivo via ESPN
  (poll a cada 60s).
- Reaproveita o design system da Copa (cores, cards, botões, breakpoints) mas com scoring e
  estrutura de dados próprios (badges de zona `.zone-badge`/`.g4-badge`/`.z4-badge`, que não
  existem na Copa — específico de torneio).
- **Gaps conhecidos vs. Copa** (documentados em `CONSISTENCY_MATRIX.md`): sem sistema de
  comprovante/PDF/e-mail ao participante, sem script de auditoria de scoring equivalente ao
  `audit_scoring.py`, sem botão "Limpar dados" na UI admin, sem backup JSON, sem
  `AbortController`/timeout em nenhum `fetch()`, CSV usa `\n` (LF) em vez do `\r\n` (CRLF) já
  corrigido na Copa desde v3.0, apenas idioma pt-BR ativo (ES/EN desabilitados desde v1.12).
- Toolbar admin: apenas 2 botões (CSV, Sync).

### CDB2026 (`bolao/cdb2026/`) — não publicado

- URL: `ferrarilabs.github.io/bolao/cdb2026/` (sem link do site principal).
- Formato: mata-mata com times reais da Copa do Brasil 2026, sem nenhuma API externa (dados
  estáticos em `js/data.js` — o formato do torneio, com poucos jogos, ainda não demandou
  polling ao vivo).
- Mesmos gaps de BR2026 em relação à Copa, mais: **nenhuma detecção de jogo adiado**
  (`postponed`) — BR2026 já implementou isso desde v1.13, CDB2026 ainda não.
- Toolbar admin: apenas 2 botões (CSV, Sync).

Todos os três compartilham: padrão de arquivos (`index.html`, `css/styles.css`, `js/config.js`,
`js/data.js`, `js/i18n.js`, `js/app.js`), autenticação admin (hash SHA-256 idêntico nos três —
ver "Limitações"), sessão de 30 min, lockout 5 tentativas/15 min, `guardAdmin()` em toda ação,
merge local-first com Supabase, enforcement client-side de cutoff, mesma URL/anon key do
Supabase (isolados por linha via `id`), mesmas chaves/templates do EmailJS, mesmos tokens
visuais (cores, padding, border-radius, breakpoints 900/500/480px).

---

## Tecnologias

- **HTML** — página única por app; seções mostradas/ocultadas via JS (sem roteamento real).
- **CSS** — um arquivo por app, mobile-first, tokens via CSS variables (`var(--green)`,
  `var(--danger-bg)`, etc.), sem framework CSS.
- **JavaScript** — ES5-compatível, vanilla, sem TypeScript, sem bundler, sem framework
  (React/Vue/etc.), tudo em uma IIFE por app. Delegação de evento única
  (`document.addEventListener("click"/"change", ...)` com `e.target.closest(seletor)`) — sem
  `onclick` inline.
- **EmailJS** (`@emailjs/browser@4`) — envio de e-mail direto do browser, sem backend. Rate
  limit `limitRate: { throttle: 30000 }` (1 e-mail/30s por sessão de browser). Corpo do
  template deve conter **apenas** `{{{html_message}}}` — decisão deliberada desde v3.0 (ver
  `LESSONS_LEARNED.md`).
- **Supabase** — Postgres gerenciado, usado só como espelho de estado via tabela única
  (`bolao_state`, uma linha por app: `main`/`br2026`/`cdb2026`), RLS restringindo `anon` a
  ler/escrever apenas sua própria linha. Só a chave `anon`/`publishable` é usada — nunca
  `service_role`.
- **API-Football** (`v3.football.api-sports.io`) — polling opcional de resultados ao vivo,
  desabilitado por padrão (`enabled: false`, `apiKey: ""`). Free tier: 100 req/dia.
- **ESPN** (endpoint não oficial `site.api.espn.com`) — fonte de placar ao vivo, relógio,
  período (`status.period`), probabilidade e artilheiros na Copa; standings/scoreboard/schedule
  no BR2026.
- **Polymarket** (`gamma-api.polymarket.com`) — probabilidades públicas usadas internamente
  para enviesar o simulador "smart"; sem UI dedicada.
- **GitHub Pages** — hospedagem estática, deploy automático no push para `main`. Sem etapa de
  build.
- **GitHub Actions** — `sync_version.yml` (cache-busting automático do `?v=` em `index.html`,
  hoje disparado por qualquer mudança em `bolao/js/**.js` ou `bolao/css/**.css`, usando o SHA
  curto do commit em vez de uma string de versão mantida manualmente) e um workflow agendado
  que roda `send_result_email.py --auto`.
- **Python** (`bolao/scripts/*.py`) — scripts operacionais fora do runtime do browser:
  `audit_scoring.py` (auto-teste de scoring/bracket), `send_result_email.py` (e-mail
  automático de resultado, reimplementa a lógica de scoring em Python), `backup.py` /
  `backup_daily.py` / `backup_watch_m88.py`, `auto_reopen.py`, `reopen_after_r32.py`,
  `who_can_still_podium.py`, `send_bracket_correction_email.py`.

---

## Decisões arquiteturais

- **Sem build step, sem framework, sem bundler.** Decisão fundacional: o site é hospedado no
  GitHub Pages sem etapa de build, então qualquer complexidade de toolchain (webpack, npm
  install, transpiler) seria fricção pura para um app estático de baixo tráfego. O preço pago é
  código ES5-compatível manual e uma IIFE monolítica por app em vez de módulos.
- **Local-first com Supabase como espelho opcional, não como fonte única de verdade.** O app
  precisa funcionar mesmo se o Supabase cair ou nunca for configurado — é um bolão informal,
  não pode depender de infraestrutura paga/gerenciada para a funcionalidade básica. Consequência:
  toda a lógica de merge existe para reconciliar dois estados que podem divergir, e isso já
  gerou vários bugs reais (ver `LESSONS_LEARNED.md`).
- **`results` remote-wins, `paid` any-true-wins, `entries` união com tombstones.** Cada campo
  tem uma regra de merge diferente porque o significado de "conflito" é diferente: um resultado
  real (digitado pelo admin) nunca deve regredir para um valor de teste esquecido em outro
  dispositivo; um pagamento marcado em qualquer lugar deve contar; uma entrada deletada não
  pode "ressuscitar" só porque outro dispositivo ainda tem uma cópia antiga no `localStorage`.
- **Uma única implementação de scoring (`scoreEntry`) reusada em todo o site.** Ranking, CSV,
  master export e o e-mail manual do admin chamam a mesma função — o site não pode discordar
  de si mesmo internamente. O `send_result_email.py` (Python, fora do browser) *não* consegue
  compartilhar essa função e reimplementa a lógica — esse é o ponto estrutural de risco que
  gerou o incidente de julho de 2026 (ver "Auditorias realizadas").
- **Admin auth é client-side por design, aceito como limitação conhecida.** Para um app
  informal de amigos/família, um backend de autenticação real (Supabase Auth, JWT, etc.) foi
  julgado desproporcional ao risco. A mitigação é hash SHA-256 + lockout + sessão curta, não
  autenticação real — documentado explicitamente como aceitável em `SECURITY.md` e como item
  de roadmap de longo prazo (`L-02`) se o app crescer.
- **Cutoff de entrada é client-side.** Mesma lógica: um backend com timestamp de servidor
  (Supabase RLS por data) resolveria o risco de manipulação de relógio, mas foi julgado
  desnecessário para o caso de uso atual — está documentado como risco aceito e como item de
  roadmap (`L-04`).
- **Chave anon do Supabase é pública de propósito.** RLS restringe cada app à sua própria
  linha (`id = 'main'`/`'br2026'`/`'cdb2026'`); qualquer visitante pode ler/escrever essa linha
  — decisão consciente porque é "um bolão público e transparente", não dado sensível.
- **Três apps independentes, não uma plataforma multi-tenant.** Cada torneio (Copa,
  Brasileirão, Copa do Brasil) tem sua própria estrutura de bracket/scoring — generalizar em
  uma base de código compartilhada foi explicitamente rejeitado (`ROADMAP.md`: "Multiple pools
  ... não é necessário para o caso de uso de amigos/família"). O preço é duplicação de código
  entre os três; o benefício é que uma mudança arriscada em um app novo nunca afeta
  automaticamente a Copa (que já tem dinheiro real em jogo) — ver `PLATFORM_GOVERNANCE.md`.
- **`matchPoints` extraído de `scoreEntry`** para eliminar duplicação entre o cálculo do total
  e a exibição de pontos por partida na tabela de palpites — decisão de refatoração explicitada
  como "sem mudança de comportamento" e verificada antes de aceitar.
- **Toasts não-bloqueantes substituindo `alert()`**, exceto para: validação de formulário (erro
  que precisa de atenção imediata) e popup bloqueado — mantidos como `alert()` deliberadamente.
  Ações destrutivas (deletar, limpar dados, sobrescrever palpites) continuam usando `confirm()`
  deliberadamente, pela necessidade de confirmação síncrona bloqueante.
- **`audit_scoring.py` como gate obrigatório antes de qualquer e-mail automático**, e como
  passo obrigatório depois de qualquer mudança no repositório (relacionada a scoring ou não) —
  decisão tomada diretamente por Eduardo depois do incidente de julho de 2026, hoje uma regra
  permanente em `CLAUDE.md`.

---

## Limitações

- **Autenticação admin é 100% client-side** — um atacante com acesso ao código-fonte pode, em
  teoria, tentar quebrar o hash SHA-256 offline (mitigado por lockout, mas o lockout também é
  client-side e reseta se o `localStorage` for limpo).
- **Cutoff de entrada é enforced só no client** — manipulação de relógio local pode contornar o
  bloqueio (mitigado apenas pelo "sistema de honra" e pela possibilidade de o admin deletar
  entradas fraudulentas manualmente).
- **Chaves EmailJS, Supabase anon e API-Football (se configurada) são sempre visíveis no
  código-fonte do browser** — inerente a um app 100% frontend, sem proxy/backend.
- **Sem servidor real** — todo o estado é reconstruído do `localStorage` a cada carregamento de
  página; não há SSR nem cache de servidor.
- **BR2026 e CDB2026 não têm sistema de comprovante/PDF/e-mail ao participante**, apesar de o
  texto de transparência desses apps mencionar "comprovantes" como evidência — gap conhecido,
  catalogado como item `High` em `CONSISTENCY_MATRIX.md` (linhas 8–10).
- **BR2026 e CDB2026 não têm um `audit_scoring.py` equivalente** — o mesmo tipo de drift entre
  site e script de e-mail que ocorreu na Copa em julho de 2026 poderia se repetir neles sem
  detecção automática.
- **Nenhum dos três apps tem `AbortController`/timeout em todos os `fetch()`** — a Copa cobre 5
  de 9 chamadas; BR2026/CDB2026 não cobrem nenhuma. Requisições a ESPN/Supabase podem travar
  indefinidamente sem timeout nos dois apps novos.
- **Sincronização multi-dispositivo não é em tempo real** — depende de polling e dos eventos
  `focus`/`visibilitychange`; não usa Supabase Realtime (roadmap `M-02`, não implementado).
- **Matching de nomes de time entre fontes (ESPN, API-Football, Polymarket, `data.js`) é
  fuzzy** — divergências de nome (ex.: "USA" vs "United States") já causaram bugs reais e
  seguem sendo um ponto frágil, mitigado caso a caso via listas de aliases.
- **`data.js` não é atualizado automaticamente** — resultados de API externa nunca sobrescrevem
  a estrutura do bracket sozinhos; reconciliação de estrutura (não de resultado) ainda é
  manual, por design, para não arriscar quebrar um bracket já validado.

---

## Banco

- **Provedor:** Supabase (Postgres gerenciado).
- **Tabela única, compartilhada pelos três apps:** `public.bolao_state`.
  ```sql
  create table if not exists public.bolao_state (
    id text primary key check (char_length(id) <= 50),
    state jsonb not null default '{}'::jsonb check (pg_column_size(state) < 1048576),
    updated_at timestamptz not null default now()
  );
  ```
- **Isolamento por linha:** `id = "main"` (Copa), `"br2026"`, `"cdb2026"`. RLS restringe o role
  `anon` a ler/inserir/atualizar apenas a própria linha de cada app.
- **Limite:** estado máximo de 1 MB por linha (constraint `pg_column_size(state) < 1048576`),
  `id` máximo 50 caracteres.
- **Nunca a `service_role` key** — só a chave `anon`/`publishable`, que é segura de commitar
  porque RLS já limita o escopo.
- **`database.enabled`:** `true` na Copa; `false` em BR2026/CDB2026 (aguardando criação da
  linha correspondente antes de publicar).
- **Merge:** ver seção "Arquitetura" — union de `entries` com tombstones, any-true-wins em
  `paid`, remote-wins em `results`.
- **Debounce de escrita:** 400ms por padrão; ações administrativas (pagamento, resultado, sync
  ESPN, limpar dados, deletar entrada) forçam escrita imediata (`forceResults: true`) desde
  v4.8/v4.9, para eliminar a janela de corrida em que backgrounding no mobile cancelava o
  `setTimeout` pendente antes do Supabase receber o dado.

---

## Email

- **Provedor:** EmailJS (SDK de browser, sem backend próprio).
- **Rate limit:** `limitRate: { throttle: 30000 }` — 1 e-mail a cada 30s por sessão de browser.
- **Corpo do template:** deve conter **apenas** `{{{html_message}}}` — nenhum outro campo. Essa
  é uma decisão deliberada desde v3.0, depois que um payload com campos além de
  `html_message` causou problemas (ver `LESSONS_LEARNED.md`, item "Email multipart / payload").
- **Dois templates:** recibo ao participante (`participantTemplateId`) e notificação ao admin
  (`adminTemplateId`).
- **Conteúdo:** sempre o output de `receiptHtml()`/gerador equivalente, que aplica
  `escapeHtml()`/`esc()` em todo dado de usuário antes de montar a string HTML.
- **Fora do browser:** `bolao/scripts/send_result_email.py` (Python) envia e-mails
  automaticamente via cron/GitHub Actions quando uma partida termina — reimplementa a lógica de
  scoring/bracket de forma independente do `app.js` (não pode importar JS do site), o que é a
  origem estrutural do incidente de julho de 2026 (ver "Auditorias realizadas"). Desde então,
  `send_result_email.py --auto` roda `audit_scoring.py` antes de tocar em qualquer coisa e se
  recusa a enviar e-mail se a auditoria falhar; também revalida cada resultado individualmente
  em runtime (data do evento não é futura, times totalmente resolvidos, formato de placar são)
  antes de confiar nele.
- **Confirmação dupla antes de enviar automaticamente:** desde v4.55, `send_result_email.py
  --auto` refaz o fetch da ESPN uma segunda vez, 20s depois do primeiro, e só salva/envia se os
  dois fetches concordarem exatamente no placar e em quem avança — caso contrário, pula e tenta
  de novo no próximo ciclo do cron.

---

## PDF

Não existe geração de PDF real (server-side ou biblioteca dedicada). O fluxo é:

1. `receiptHtml()`/equivalente gera uma string HTML autocontida.
2. `openReceipt()` cria um Blob URL e abre em nova aba via `window.open` — **nunca**
   `document.write`.
3. O usuário usa a função "Imprimir"/"Salvar como PDF" nativa do navegador sobre essa aba.
4. Alternativa: "Download HTML" baixa o arquivo `.html` localmente, sem depender de popup.

Não há testes automatizados específicos de PDF; a garantia é sobre o HTML gerado (autocontido,
escapado) ser corretamente renderizável e imprimível pelo navegador. BR2026 e CDB2026 não têm
nenhum equivalente a este fluxo (gap conhecido, ver "Limitações").

---

## Scoring

**Esta é a parte do site que nunca pode quebrar — dinheiro real é pago com base nela**, nos
três apps (US$5/entrada cada).

### Copa do Mundo 2026

Pontuação só para os 32 jogos de mata-mata (73–104); fase de grupos é exibida mas não pontua.

| Evento | Pontos |
|---|---|
| Placar exato (90 min + prorrogação) | 10 |
| Time vencedor correto (avanço) | 5 |
| Um dos dois placares de gol correto | 1 |
| Bônus campeão | +25 |
| Bônus vice-campeão | +15 |
| Bônus 3º lugar | +10 |
| Bônus 4º lugar | +5 |

Pênaltis não afetam a pontuação — só gols em 90 min + prorrogação contam. Em caso de empate, o
participante escolhe quem avança (`advanceSide`).

BR2026 e CDB2026 têm fórmulas próprias, específicas de cada formato de torneio (G4/Z4 para
Brasileirão, mata-mata para Copa do Brasil) — **deliberadamente não generalizadas** entre os
apps (`PLATFORM_GOVERNANCE.md`: diferenças de torneio devem ser preservadas).

### Implementação

- `scoreEntry(entry, state)` é a única fonte de verdade no site da Copa — chamada uma vez por
  entrada por render, usada em ranking, CSV, master export e e-mail manual do admin.
- `matchPoints(pick, result)` foi extraída de `scoreEntry` para reuso sem duplicação.
- `bolao/scripts/audit_scoring.py` é uma suíte de 5 checagens estáticas, executável isolada
  (`python3 audit_scoring.py`) ou importada por `send_result_email.py`:
  1. Bracket do script Python (`MATCH_TEAMS`) bate com `data.js`.
  2. Simulação de torneio completo com bracket "perfeito" — campeão resolve corretamente
     através das 4 rodadas de mata-mata.
  3. Bônus (25/15/10/5) + 4º lugar presentes e somados corretamente.
  4. Placar/validação de formato bate com as mesmas regras do site.
  5. Ordem de desempate (tiebreak cascade) correta.
- Regra permanente (`CLAUDE.md`): `send_result_email.py --auto` roda essa auditoria antes de
  tocar em qualquer coisa e se recusa a enviar e-mail se falhar; **qualquer** mudança no
  repositório — relacionada a scoring ou não — deve rodar `audit_scoring.py` e reportar o
  resultado.

---

## Ranking

- Calculado ao vivo a partir do `localStorage`/estado mesclado a cada render — não há
  pré-cálculo persistido.
- Ordenação: pontuação total decrescente; medalhas 🥇🥈🥉 para top 3; tabela de palpites
  expansível por entrada.
- **Cascata de desempate (tiebreak), decidida por Eduardo em v4.36** após um print de WhatsApp
  mostrando duas entradas empatadas em 1º lugar:
  1. Mais placares exatos.
  2. Mais acertos de pódio (campeão/vice/3º).
  3. Se ainda empatado: posição compartilhada — prêmio dessa colocação é dividido manualmente
     (pagamento não é automatizado).
  4. (Adicionado depois, para exibição apenas) Para entradas totalmente empatadas nos 3 níveis
     acima: ordem alfabética reversa (Z→A) do nome da entrada, comparação de code-point puro,
     sem collation de locale — não muda quem está empatado, pontos, ou medalha/posição
     compartilhada, só a ordem de exibição entre nomes totalmente empatados.
- A cascata é implementada **de forma idêntica** em três lugares: ranking do site
  (`renderRanking()`), o construtor de e-mail manual do admin, e o script Python
  `send_result_email.py` — verificado no incidente de julho de 2026 e coberto pelo
  `audit_scoring.py`.
- Ranking dispara `debouncedReload()` ao ser aberto (desde v4.108) para sempre buscar dado
  fresco do Supabase ao ser visualizado.
- "Pontos provisórios ao vivo": preview client-side, calculado durante uma partida em
  andamento, **nunca grava no Supabase** — só quando a partida termina oficialmente é que o
  banco é atualizado (confirmado explicitamente por Eduardo em v4.32).

---

## Administração

- **Login:** comparação de hash SHA-256 via `crypto.subtle.digest`, sem biblioteca externa.
- **Lockout:** 5 tentativas erradas → bloqueio de 15 minutos (`sessionStorage["adminLockUntil"]`
  na Copa — nota: `SECURITY.md`/`ARCHITECTURE.md` ainda descrevem isso como `localStorage`,
  divergência documentada como pendência em `CONSISTENCY_MATRIX.md` item 3).
- **Sessão:** 30 minutos, `sessionStorage`, limpa ao fechar a aba. `extendAdmin()` estende a
  janela a cada render admin bem-sucedido.
- **`guardAdmin()`** chamado em **toda** ação admin (não só no login) — uma sessão expirada não
  consegue executar nenhuma ação.
- **Ações da Copa (13 no toolbar):** marcar pagamento (toggle button, não checkbox — ver
  `LESSONS_LEARNED.md`), entrada de resultado real por partida, deletar entrada (com motivo
  opcional + e-mail de remoção), dados demo (3 entradas: Ana/Bruno/Carlos Demo), API-Football
  (cache + aplicação de resultado), sync ESPN, e-mail de teste, e-mail em massa, sync remoto
  manual (força descarte do `localStorage` e recarrega do Supabase), limpar todos os dados
  (local + remoto, com confirmação dupla), exports (Master CSV, Backup CSV completo, Backup
  JSON, Master HTML).
- **BR2026/CDB2026:** apenas 2 ações no toolbar (CSV, Sync) — sem "Limpar dados" na UI (só via
  Supabase direto), sem backup JSON, sem dados demo, sem Master HTML.
- **Procedimentos de emergência via Supabase direto** (documentados em `ARCHITECTURE.md`):
  marcar pagamento manualmente, inserir/corrigir/remover resultado, deletar entrada, reset
  total de estado, adicionar entrada manual (late submission), renomear entrada, resetar senha
  admin, ler estado sem o app, sincronizar dispositivo com dado obsoleto, recuperar de
  `localStorage` corrompido, exportar todos os dados sem o app.
- **Senha admin compartilhada entre os três apps** (mesmo hash SHA-256 nos três) — decisão
  consciente registrada em `CONSISTENCY_MATRIX.md` item 2, com a ressalva de que comprometer
  uma credencial compromete os três painéis; considerar hashes distintos antes de publicar os
  outros dois.

---

## APIs

| API | Uso | Status |
|---|---|---|
| Supabase REST | Persistência remota (espelho do estado) | Ativa nos 3 apps (Copa `enabled:true`; BR2026/CDB2026 `enabled:false`, aguardando linha) |
| EmailJS | Envio de comprovante/notificação | Ativa na Copa; config presente mas sem UI dedicada de notificação admin em BR2026/CDB2026 |
| ESPN (não oficial) | Placar ao vivo, relógio, período, artilheiros, probabilidade (fallback) | Ativa na Copa (poll dinâmico) e BR2026 (poll 60s); ausente em CDB2026 (sem API externa, dados estáticos) |
| API-Football (api-sports.io) | Polling opcional de resultados finais, aplica ao bracket sem sobrescrever entrada manual | Desabilitada por padrão nos 3 apps (`enabled:false`, `apiKey:""`); free tier 100 req/dia |
| Polymarket Gamma API | Probabilidades públicas para enviesar o simulador "smart" | Interno, sem UI dedicada; só Copa |

Todas as chamadas de rede externas usam CSP (`connect-src`) restrito por app — cada CSP reflete
só o que aquele app realmente chama (Copa tem o escopo mais amplo: ESPN, API-Football,
Polymarket, ipify; BR2026 escopo médio: ESPN + espncdn; CDB2026 escopo mínimo: só
Supabase/EmailJS).

Só a Copa usa `AbortController`/timeout em parte de suas chamadas (5 de 9); BR2026/CDB2026 não
usam em nenhuma — gap conhecido (`CONSISTENCY_MATRIX.md` item 50).

---

## Internacionalização

- Todas as strings de UI vivem em `js/i18n.js` por app, como objetos por idioma (nunca texto
  solto no HTML/JS).
- **Copa:** 3 idiomas completos — `pt-BR` (padrão/fallback), `es` (Espanhol/México), `en-US` —
  cerca de 735 chaves totais, alternados via botões de bandeira no header (não dropdown — o
  dropdown foi removido em v3.3.4 por pedido explícito do Eduardo).
- **BR2026/CDB2026:** apenas `pt-BR` implementado (~145 e ~101 chaves respectivamente); botões
  ES/EN existem na UI mas ficam `disabled` (decisão registrada nos commits recentes, não é bug).
- `t(key)`: busca em `I18N[currentLang]`, cai para `I18N["pt-BR"]`, senão retorna a própria
  chave (nunca quebra a UI por chave faltante).
- Idioma persistido em `localStorage["bolao_lang"]`.
- Todo texto renderizado passa por `t()` + `escapeHtml()`/`esc()` — nunca string crua no DOM.
- Item de roadmap não implementado: suporte a japonês (`ja`) — mencionado historicamente no
  `CLAUDE.md` mas nunca chegou a ser adicionado ao `i18n.js` (`ROADMAP.md` M-03).

---

## Segurança

Modelo de ameaça explícito: app informal de amigos/família, sem servidor próprio, sem dado
financeiro sensível armazenado (só nome do método de pagamento, nunca número de cartão).

**No escopo:** XSS, exposição acidental de credencial, sequestro de sessão admin, adulteração
de dado por participante mal-intencionado.
**Fora do escopo:** ataques server-side (não há servidor), DDoS, MITM (GitHub Pages usa HTTPS
por padrão), responsabilidade legal (o app é explicitamente informal).

- **CSP** via `<meta http-equiv="Content-Security-Policy">` em cada `index.html` — escopo
  mínimo necessário por app (ver tabela em "APIs"). Scripts inline bloqueados; todo JS é
  arquivo externo.
- **XSS:** todo dado de usuário passa por `escapeHtml()`/`esc()` antes de qualquer inserção no
  DOM. Nenhum `innerHTML` com dado cru. Nenhum `eval()`/`new Function()`. Nenhum
  `document.write` (comprovantes usam Blob URL).
- **Supabase:** só a chave `anon`/`publishable` no frontend; `service_role` nunca aparece no
  código. RLS restringe cada app à sua própria linha.
- **EmailJS:** chave pública inevitavelmente visível no código-fonte (app 100% browser);
  mitigada por rate limiting (30s/e-mail).
- **API-Football:** chave desabilitada por padrão; se habilitada, ficaria visível no
  código-fonte — recomendação explícita de usar um proxy (Supabase Edge Function) em produção,
  ainda não implementado (item de roadmap `L-03`, e há um `TODO` correspondente em
  `bolao/js/app.js:3001`).
- **Admin:** hash SHA-256 (nunca senha em texto puro em lugar nenhum), lockout, sessão curta,
  `guardAdmin()` em toda ação — aceito como best-effort client-side, não autenticação real
  (ver "Decisões arquiteturais" e roadmap `L-02`).
- **SRI (Subresource Integrity):** scripts de CDN (EmailJS, Supabase) carregados com hash
  `integrity` fixado — protege contra CDN comprometido servindo um bundle diferente do
  esperado.
- **Dados expostos por design:** nome, nome do pagador, método de pagamento e status de
  pagamento de todas as entradas são visíveis publicamente no ranking — é um bolão
  transparente, isso é intencional, não um vazamento.
- **Cutoff client-side** — ver "Limitações".

---

## Auditorias realizadas

### Auditoria de scoring/ranking "estilo big 4" (julho de 2026)

Disparada por um print de WhatsApp de uma participante (Aline) confusa com uma mudança de
posição no ranking (a confusão em si já tinha explicação legítima — resultado de uma partida
havia acabado de entrar), mas Eduardo pediu uma auditoria completa e pediu que isso virasse
prática padrão antes de qualquer PR futuro. Escopo: `app.js` (site) vs. `send_result_email.py`
(script de e-mail). Resultado: o site estava limpo (uma única implementação de `scoreEntry()`
usada em todo lugar, não pode discordar de si mesmo); o script Python havia sofrido drift real
porque reimplementa a mesma lógica de forma independente:

- **Crítico:** o bracket hardcoded do script (`MATCH_TEAMS`) não batia com `data.js` em 9 dos
  16 jogos de oitavas/quartas — teria feito o lookup na ESPN falhar silenciosamente para essas
  partidas assim que as oitavas começassem, parando o pipeline de e-mail automático pro resto
  do torneio sem nenhum erro visível.
- **Alto:** os pontos de bônus de pódio (25/15/10/5) eram computados só para efeito de
  desempate, nunca somados ao total do e-mail — o site já soma. Divergência que só apareceria
  perto da final, o momento de maior valor em jogo.
- **Alto:** 4º lugar era calculado internamente por duas funções mas descartado do que
  retornavam — o bônus de 4º nunca poderia ser concedido, mesmo corrigindo o item acima.
- **Baixo:** o parser de placar em Python aceitava valores negativos/fora de faixa que o
  formulário do browser já rejeitava.

Todas corrigidas e verificadas com testes automatizados (diff programático entre `MATCH_TEAMS`
e `data.js`; simulação completa de torneio com bracket perfeito). Consequência permanente: essa
auditoria foi empacotada em `bolao/scripts/audit_scoring.py`, hoje rodada automaticamente antes
de qualquer e-mail (`send_result_email.py --auto`) e como regra obrigatória em `CLAUDE.md` para
qualquer mudança no repositório.

### Auditoria de reload loop + 7 quick wins (v4.109)

Encontrou um bug crítico de reload infinito (`startReopenPolling()` comparando datas de forma
sempre-verdadeira, forçando `location.reload()` a cada 60s para todos os visitantes) mais 6
problemas menores (setInterval de 1s rodando em background, strings hardcoded em PT fora do
i18n, chave duplicada `Scotland` em `data.js`).

### Auditoria de payloads maliciosos/malformados (extração de artilheiros)

13 payloads maliciosos/malformados testados contra a função de extração de gols
(`details` ausente/nulo/não-array, atletas ausentes, tipos de evento desconhecidos como
"Offside"/"Corner Kick") — todos passaram sem quebrar o placar/relógio ao vivo. Motivada por um
bug real em que essa mesma função travava o placar ao vivo por falta de guarda (ver
`LESSONS_LEARNED.md`).

### Auditoria de governança de plataforma (2026-07-12)

Auditoria cross-app de 60 áreas comparando Copa (v4.125), BR2026 (v1.13) e CDB2026 (v1.6) —
design system, admin, segurança, e-mail/comprovante, live scores, i18n, acessibilidade, CSP.
Resultado consolidado em `docs/bolao/CONSISTENCY_MATRIX.md`: 0 divergências críticas, 3 áreas
de severidade alta (falta de `audit_scoring.py` equivalente e de sistema de comprovante em
BR2026/CDB2026), 12 de severidade média, 14 de baixa. Gerou `PLATFORM_GOVERNANCE.md` e
`QA_MASTER_CHECKLIST.md` como artefatos permanentes de processo.

---

## Bugs históricos

Ver `docs/bolao/LESSONS_LEARNED.md` para o detalhamento completo (causa raiz, correção,
prevenção) de cada bug relevante. Resumo dos bugs mais significativos por categoria:

- **Sincronização/estado:** entradas deletadas "ressuscitando" via sync (tombstones ausentes);
  resultados de teste em `localStorage` local sobrescrevendo resultados reais do Supabase;
  cache HTTP do Safari/iOS servindo `index.html` antigo mesmo com service worker "network-first".
- **Scoring/e-mail:** drift do bracket e da fórmula de bônus entre `app.js` e
  `send_result_email.py` (auditoria de julho de 2026, ver acima).
- **UI/mobile:** flag+nome de time como string única impedindo reordenação por CSS em mobile;
  regra de grid de 2 colunas do countdown principal vazando para o cronômetro de 3 células do
  card "próximo jogo"; card do hero renderizando vazio depois de esconder todo o conteúdo
  interno via CSS.
- **Relógio ao vivo:** múltiplas iterações (v4.47 → v4.77) tentando reconstruir de forma
  confiável "em qual tempo/período está o jogo" a partir de um contador contínuo da ESPN sem
  essa informação — resolvido definitivamente só quando se descobriu que a própria ESPN expõe
  `status.period` como fonte de verdade.
- **Segurança/qualidade (v3.0):** senha admin em comentário de texto puro no código-fonte; hash
  de fallback alternativo coexistindo com o principal; CSV com quebra de linha LF (quebrava no
  Excel do Windows); payload de e-mail com campos além de `html_message`.
- **Deploy/infra:** dois workflows de deploy do GitHub Pages competindo entre si; cache-busting
  (`?v=`) não disparando para mudanças de CSS/JS porque só reagia a mudanças em `config.js`.

---

## Correções (padrões recorrentes)

Padrões de correção que se repetem e valem a pena reconhecer em bugs futuros:

- **Tombstones (`deletedIds[]`)** para qualquer merge aditivo que precise suportar remoção.
- **`preferRemoteResults` / remote-wins explícito** sempre que existir risco de um dispositivo
  com dado de teste sobrescrever um dado de produção via sync.
- **Escrita imediata (sem debounce) para ações administrativas**, mantendo debounce só para
  digitação/rascunho do participante.
- **Usar sinal estrutural em vez de correspondência de texto** quando a fonte externa (ESPN)
  expõe um campo mais confiável (`status.period` em vez de regex sobre `status.type.name`).
- **Extrair lógica duplicada para uma função compartilhada** (`matchPoints`,
  `liveProbBarsHtml`, `preMatchProbBarsHtml`) sempre que a mesma regra precisar aparecer em
  mais de um lugar da UI, para eliminar a possibilidade de divergência futura.
- **Auditoria automatizada + regra permanente** sempre que um bug real revelar uma classe de
  risco recorrente (scoring), em vez de apenas corrigir a instância pontual.

---

## Dívidas técnicas

- BR2026 e CDB2026 sem `audit_scoring.py` equivalente, apesar de movimentarem dinheiro real
  (US$5/entrada) antes mesmo de publicados.
- BR2026 e CDB2026 sem sistema de comprovante/PDF/e-mail ao participante, apesar do disclaimer
  de transparência desses apps mencionar "comprovantes".
- CSV de BR2026/CDB2026 usa `\n` em vez do `\r\n` já corrigido na Copa desde v3.0 (regressão
  de um bug já resolvido, reintroduzida em apps novos que não herdaram a correção).
  Consequência clássica de os três apps não compartilharem código: um bug corrigido em um app
  não se propaga automaticamente para os outros.
- Nenhuma chamada de rede em BR2026/CDB2026 usa `AbortController`/timeout.
- CDB2026 sem detecção de jogo adiado (BR2026 já tem desde v1.13).
- `SECURITY.md`/`ARCHITECTURE.md` descrevem o lockout admin como `localStorage`, mas o código
  atual usa `sessionStorage` — divergência de documentação vs. código ainda não corrigida.
- Senha admin compartilhada entre os três apps (mesmo hash) — risco aceito e registrado, não
  corrigido.
- Sem Supabase Realtime — sync depende de polling/foco de aba, não é instantâneo entre
  dispositivos abertos simultaneamente (roadmap `M-02`).
- API-Football sem proxy de produção (`TODO` em `bolao/js/app.js:3001`) — chave ficaria exposta
  se algum dia fosse habilitada com um plano pago.
- Suporte a japonês (`ja`) mencionado historicamente mas nunca implementado (roadmap `M-03`).

---

## Melhorias futuras

Ver `docs/bolao/ROADMAP.md` para a lista completa e priorizada. Resumo:

- **Curto prazo (durante a Copa 2026):** atualizar `data.js` conforme jogos terminam e
  qualificados de 3º lugar se resolvem; botão admin para aplicar cache do API-Football
  diretamente ao bracket sem edição manual.
- **Médio prazo:** Supabase Realtime (sync instantâneo entre abas); suporte a japonês; bracket
  visual em árvore em vez de lista de cards.
- **Longo prazo / próximos torneios:** checklist de bootstrap para um novo torneio
  (`siteVersion`, `storeKey`, `cutoffIso`, fixtures, bracket); autenticação admin server-side
  (Supabase Auth); proxy serverless para API-Football; enforcement server-side do cutoff via
  RLS.
- **Explicitamente descartado:** app mobile/PWA nativo; painel de odds ao vivo (Polymarket
  influencia o simulador internamente mas não terá UI dedicada, para evitar UX adjacente a
  apostas); mensagens automáticas via WhatsApp Business API; suporte a múltiplos pools na mesma
  base de código (a separação em três apps independentes já resolve esse caso de uso).
- **Antes de publicar BR2026/CDB2026:** fechar os gaps `High`/`Medium` listados em
  `CONSISTENCY_MATRIX.md` — auditoria de scoring, sistema de comprovante, CSV CRLF,
  `AbortController`, botão "Limpar dados", backup JSON, `assets/` (QR codes de pagamento),
  botão de suporte via WhatsApp, badge de status de jogo, detecção de jogo adiado (CDB2026).
