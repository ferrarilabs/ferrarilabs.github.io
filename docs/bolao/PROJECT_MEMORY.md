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
  `audit_scoring.py`, sem botão "Limpar dados" na UI admin, sem backup JSON, CSV usa `\n` (LF)
  em vez do `\r\n` (CRLF) já corrigido na Copa desde v3.0, apenas idioma pt-BR ativo (ES/EN
  desabilitados desde v1.12).
- **v1.23 (2026-07-13) — classificação ao vivo + movimento de ranking**: `fetchJson()` com
  `AbortController`/timeout de 10s agora cobre todo `fetch()` do app (gap fechado, listado acima
  como resolvido); `pollAll()` virou um `setTimeout` autorreagendado com backoff em falha e pausa
  quando `document.hidden`, em vez de `setInterval` fixo. Tabela do Brasileirão ganhou coluna
  "Mov." e reordena por posição ao vivo durante uma janela de partidas (`calculateLiveStandings()`
  — função pura, baseline em `sessionStorage`, nunca no estado principal). Ranking do bolão ganhou
  movimento de participante (`calculateRankingMovement()`, padrão stateless correto, não o padrão
  de sessão imperfeito que a Copa usa hoje). Detalhe completo, incluindo a auditoria da Copa e a
  definição de baseline usada: `docs/bolao/BR2026_LIVE_STANDINGS.md`. Não alterou scoring nem
  regras do Brasileirão.
- Toolbar admin: apenas 2 botões (CSV, Sync).

### CDB2026 (`bolao/cdb2026/`) — não publicado

- URL: `ferrarilabs.github.io/bolao/cdb2026/` (sem link do site principal).
- **Reformulado do zero em v3.0 (2026-07-13)** — fonte oficial do modelo:
  `docs/bolao/CDB2026_RULES_AND_MODEL.md`. Até v2.9 o app copiava a estrutura de mata-mata fixo
  da Copa do Mundo (16 times, 15 confrontos definidos em `data.js` desde o início, ida+volta em
  tudo exceto a final) — **modelo errado**, identificado por Eduardo com o regulamento oficial
  em mãos. A Copa do Brasil real tem 126 clubes, 9 fases (1ª–4ª e Final em partida única, 5ª–8ª
  incluindo Semifinal em ida+volta), com **sorteio progressivo a cada fase** — não um
  chaveamento pré-conhecido.
- **Modelo v3.0**: `data.js` só declara as 9 fases (nome/formato/ordem, é regulamento, não muda
  durante o torneio) — nenhum confronto fica no código-fonte. Confrontos/partidas vivem no
  estado dinâmico (`s.phases[faseId].ties`), cadastrados pelo admin conforme cada sorteio real
  acontece (tela admin "Fases e confrontos"). Participante palpita cada PARTIDA (nunca um
  agregado digitado direto); agregado de ida+volta é sempre calculado, nunca digitado. Cutoff é
  por fase, não mais um valor único global.
- **Sem nenhuma API externa** (dados 100% cadastrados manualmente pelo admin — a Copa do Brasil
  tem 126 clubes de todas as divisões, sem uma fonte única de dados ao vivo equivalente ao
  standings da Série A que o BR2026 usa).
- Mesmos gaps de BR2026 em relação à Copa, mais: **nenhuma detecção de jogo adiado/cancelado**
  dedicada (fica como partida sem placar até o admin decidir manualmente) e **nenhum log de
  auditoria de alterações administrativas** — ambos registrados como dívida técnica em
  `CDB2026_RULES_AND_MODEL.md`.
- Toolbar admin: CSV, JSON, Sync, Limpar tudo — mais a tela nova "Fases e confrontos".

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
- **Nenhum dos três apps cobre 100% dos `fetch()` com `AbortController`/timeout** — a Copa cobre
  5 de 9 chamadas; BR2026 cobre todas (fechado em v1.23, ver "Auditorias realizadas"); CDB2026
  não cobre nenhuma. Requisições sem timeout podem travar indefinidamente na Copa (parcial) e no
  CDB2026 (nenhuma).
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
| Supabase REST | Persistência remota (espelho do estado) | Ativa nos 3 apps desde 2026-07-13 (`enabled:true` em Copa, BR2026 e CDB2026 — mesmo projeto/tabela `bolao_state`, uma linha por app via `stateId`). Depende de uma alteração de RLS ainda pendente do lado do Supabase — ver `docs/bolao/DATABASE_SETUP_SUPABASE.md` "Múltiplos apps na mesma tabela" |
| EmailJS | Envio de comprovante/notificação | Ativa na Copa; config presente mas sem UI dedicada de notificação admin em BR2026/CDB2026 |
| ESPN (não oficial) | Placar ao vivo, relógio, período, artilheiros, probabilidade (fallback) | Ativa na Copa (poll dinâmico) e BR2026 (poll 60s); ausente em CDB2026 (sem API externa, dados estáticos) |
| API-Football (api-sports.io) | Polling opcional de resultados finais, aplica ao bracket sem sobrescrever entrada manual | Desabilitada por padrão nos 3 apps (`enabled:false`, `apiKey:""`); free tier 100 req/dia |
| Polymarket Gamma API | Probabilidades públicas para enviesar o simulador "smart" | Interno, sem UI dedicada; só Copa |

Todas as chamadas de rede externas usam CSP (`connect-src`) restrito por app — cada CSP reflete
só o que aquele app realmente chama (Copa tem o escopo mais amplo: ESPN, API-Football,
Polymarket, ipify; BR2026 escopo médio: ESPN + espncdn; CDB2026 escopo mínimo: só
Supabase/EmailJS).

Copa usa `AbortController`/timeout em parte de suas chamadas (5 de 9); BR2026 usa em 100% desde
v1.23 (`fetchJson()` wrapper); CDB2026 não usa em nenhuma — gap conhecido
(`CONSISTENCY_MATRIX.md` item 50).

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

### Auditoria de modelo de negócio — CDB2026 usava bracket errado (2026-07-13)

Eduardo, com o Regulamento Específico da Copa do Brasil 2026 em mãos, apontou que o CDB2026
(v2.9) estava modelando a competição errado — copiava o mata-mata fixo de 16 times/15
confrontos da Copa do Mundo em vez das 9 fases reais (126 clubes, sorteio progressivo, 1ª–4ª e
Final em partida única, só 5ª–8ª+Semifinal em ida+volta). Auditoria completa respondendo às 12
perguntas obrigatórias, relatório de findings por severidade, proposta de modelo e plano de
migração em `docs/bolao/CDB2026_RULES_AND_MODEL.md` — 4 perguntas de confirmação respondidas
por Eduardo (sem entradas reais → reescrita limpa; bônus campeão/vice mantido 30/20; 1ª Fase
cadastrada via admin, não hardcoded; entryFee/prêmio sem mudança) antes de qualquer código ser
escrito. Reescrita completa do app em v3.0 — ver `bolao/cdb2026/CHANGELOG.md`. Não afetou Copa
nem BR2026 (achado era específico do modelo de dados do CDB2026).

### Auditoria de movimento de ranking (Copa) + classificação ao vivo (BR2026) (2026-07-13)

Eduardo pediu para auditar se o ranking de participantes do BR2026 usa "o recurso equivalente já
existente na Copa do Mundo" antes de implementar classificação ao vivo de clube + movimento de
ranking. Achado: a Copa tem **duas implementações concorrentes** do mesmo conceito —
`computeRankArrows()`/`_rankArrowState` (usada no ranking geral, baseline = último render, um
`Map` em memória de sessão que reseta ao recarregar — viola o requisito de baseline estável) e
`liveMatchPointsTable()` (usada só no detalhe de uma partida específica, stateless,
oficial-vs-provisório recomputado a cada chamada — correta). Eduardo confirmou explicitamente
(via pergunta direta) usar o padrão correto no BR2026, divergindo de propósito do padrão com
falha que a Copa usa hoje — a Copa **não foi alterada** nesta mudança; a divergência de
implementação entre os dois apps ficou registrada como dívida técnica pré-existente da Copa em
`CONSISTENCY_MATRIX.md`, não como regressão. Detalhe completo da implementação nova do BR2026
(`calculateLiveStandings()` para clubes, `calculateRankingMovement()` para participantes, ambas
puras e com baseline documentada) em `docs/bolao/BR2026_LIVE_STANDINGS.md`. Como efeito colateral
do escopo confirmado por Eduardo, também corrigidos: matching de partida por `ev.id` estável da
ESPN (antes só por nome de time) e uso do flag `postponed` (já existia, nunca era lido) para
excluir jogos adiados/cancelados do cálculo ao vivo.

### Texto confuso nas Regras do BR2026 + confrontos "sumidos" do CDB2026 (2026-07-13)

Dois reports separados no mesmo dia, apps diferentes, não misturados:

- **BR2026**: `"🥇 1º Lugar (no G4 (posição errada))"` — parênteses duplicados. Causa:
  `renderRules()` já envolve `t("rulesInG4")`/`t("rulesInZ4")` em parênteses; as strings de
  `i18n.js` traziam parênteses próprios. Corrigido removendo o nível interno (v1.24). Sem
  equivalente em Copa/CDB2026 (não têm conceito de G4/Z4), nada a propagar.
- **CDB2026**: Eduardo viu os confrontos "desaparecidos" — comportamento esperado da reformulação
  v3.0 (fases começam vazias por design, ver seção anterior), mas frustrante para popular
  manualmente. Pediu para buscar dados reais da Copa do Brasil 2026 e automatizar após sorteios.
  **Limitação descoberta durante a investigação**: o ambiente de desenvolvimento não tem acesso
  de rede a hosts externos (proxy do sandbox bloqueia `site.api.espn.com`, `cbf.com.br`,
  `wikipedia.org` — só uma ferramenta de busca via backend interno funciona, sem fetch direto).
  Resolvido com uma ferramenta de sincronização sob demanda no admin ("Buscar da ESPN") em vez de
  tentar popular dados às cegas a partir de resumos de busca — o admin, no próprio navegador
  (com acesso de rede real), busca, revisa e confirma cada confronto individualmente antes de
  qualquer gravação. Ver `docs/bolao/CDB2026_RULES_AND_MODEL.md` seção 7. Encontrado de brinde:
  a CSP do CDB2026 nunca teve `site.api.espn.com` liberado em `connect-src` — teria bloqueado o
  fetch em produção mesmo sem o sandbox; corrigido no mesmo commit (v3.1).

### Supabase habilitado em BR2026 e CDB2026 (2026-07-13)

Eduardo pediu para não deixar nada só em `localStorage` — motivado, no contexto imediato, pelo
CDB2026 agora ter confrontos e picks reais em jogo (ESPN sync, v3.1). `database.enabled: true`
ligado nos dois apps (`js/config.js`), mantendo `localFallback: true` — a arquitetura
"local-first com espelho remoto" **não foi removida**, só passou a ter os três apps
espelhando de fato, igual à Copa já fazia. Removê-la inteiramente (fazer o app depender só do
Supabase, sem fallback) seria uma mudança de confiabilidade na direção errada — se o Supabase
cair, os apps parariam de funcionar em vez de continuar localmente — e não é o que foi pedido;
interpretação confirmada explicitamente com Eduardo antes de implementar.

**Achado durante a auditoria**: os três apps compartilham o mesmo projeto/tabela Supabase
(`bolao_state`), diferenciados só por `stateId`. As policies de RLS existentes só liberavam
`id = 'main'` (só a Copa) — ligar o flag sozinho não sincroniza nada até essa policy ser
estendida. Testado (Playwright, resposta 403 mockada): com a RLS ainda restrita, os dois apps
continuam funcionando normalmente em modo local, sem crash e sem perda de dado — falha de forma
segura, mas silenciosa. SQL para estender a RLS aos três ids entregue a Eduardo em
`docs/bolao/DATABASE_SETUP_SUPABASE.md` "Múltiplos apps na mesma tabela" — **rodado por Eduardo
em 2026-07-13**, confirmado por ele diretamente. Os três apps devem estar sincronizando de
verdade a partir de agora.

### Sincronização com ESPN do CDB2026 virou automática (v3.3, 2026-07-13)

Eduardo testou a v3.1 (clicar "Buscar da ESPN", escolher fase, clicar "Adicionar" confronto por
confronto) e reportou que o fluxo "fica muito ruim". Redesenhado: o admin escolhe apenas **qual
fase é a atual** uma vez (`s.espnSync.activePhaseId`); com isso definido, confrontos novos são
detectados e cadastrados sozinhos (ao abrir o admin, a cada 5 min se continuar aberto, ou por um
botão "Sincronizar agora"). O que continua manual e não foi automatizado: travar um resultado
— essa etapa decide o pagamento e continua exigindo o fluxo existente em "Resultados". IDs de
confrontos auto-adicionados passaram a ser determinísticos (derivados do par de times, não
`uuid()` aleatório) para que uma sincronização rodando de forma independente em dois
dispositivos não crie duas entradas para o mesmo confronto real depois do merge via Supabase.

### "Nada pode ficar só no localStorage" — investigado, não implementado como pedido literalmente (2026-07-13)

Eduardo pediu para garantir que nada fique só em `localStorage`, citando explicitamente "o mesmo
problema que tivemos nas versões antigas do bolão da Copa do Mundo" e pedindo para "garantir que
nada fique em cache". Em vez de remover `localStorage` (o que teria sido a leitura literal do
pedido), investiguei o incidente real que ele estava lembrando — `docs/bolao/LESSONS_LEARNED.md`
"Supabase — merge/sync" e "Safari" — antes de implementar, porque remover `localStorage`
inteiramente **não teria corrigido aquele bug** e teria introduzido um problema novo (o app
ficaria 100% dependente do Supabase estar no ar; hoje é local-first por design, degradando
graciosamente).

**O que o incidente real foi:** (1) resultado correto no Supabase sendo sobrescrito por
`localStorage` de teste desatualizado em outro dispositivo — causa raiz era a **regra de merge**
(`results` dava preferência ao local em vez do remoto), não a existência do `localStorage`; (2)
`index.html` desatualizado servido por cache HTTP agressivo do Safari/iOS mesmo com service
worker "network-first"; (3) bfcache do WebKit restaurando uma aba sem disparar
`visibilitychange`, deixando a página presa em estado antigo.

**Auditoria do estado atual, antes de mexer em qualquer coisa:**
- Regra de merge (`preferRemoteResults: true`, resultados travados sempre vencem do lado
  remoto) — **já corrigida nos três apps** desde as versões anteriores, confirmado lendo o
  código de `mergeStates`/`loadRemoteState` de BR2026 e CDB2026 antes de assumir que precisava
  de correção.
- Cache HTTP de `index.html`/assets estáticos — `bolao/sw.js` é **compartilhado pelos três apps**
  (todos registram o mesmo `/bolao/sw.js`) e já usa `fetch(e.request, { cache: 'no-store' })` —
  o fix da Copa (v4.111) já cobre BR2026/CDB2026 automaticamente, sem trabalho adicional.
- Listener de `pageshow`/`event.persisted` (bfcache) — **este sim estava faltando** em
  BR2026/CDB2026 (só a Copa tinha, desde v4.111) — gap já catalogado em
  `CONSISTENCY_MATRIX.md` item 23, nunca corrigido até agora. Esta era a peça real ainda
  faltando do fix documentado do incidente histórico.

**O que foi implementado**: `debouncedReload()` (mesmo padrão de `debouncedReload`/
`reloadRemoteIfVisible` da Copa) adicionado a BR2026 e CDB2026, cobrindo
`visibilitychange` + `focus` + `pageshow` — resolve o gap real (gatilho de resync não confiável
em bfcache), sem remover `localStorage` nem a arquitetura local-first. `localStorage` continua
existindo nos três apps como estava — é o design consciente e documentado da plataforma
(`docs/bolao/DATABASE_SETUP_SUPABASE.md`: "Local-first with optional remote mirror"), não uma
falha a eliminar.

Bug de ordenação encontrado durante os testes desta mudança (não relacionado ao ESPN em si): o
handler de troca de fase ativa zerava o guard de intervalo de sincronização *depois* de
`saveState()`, mas `saveState()` já dispara uma re-renderização síncrona que lia o valor antigo
do guard — corrigido invertendo a ordem. Achado só porque havia teste automatizado cobrindo o
fluxo "selecionar fase → confronto aparece sozinho" ponta a ponta, não só a função isolada.

### CDB2026: população inicial das Oitavas de Final (v3.6, 2026-07-14) — mudança de curso deliberada

Eduardo pediu, pela terceira vez, para os confrontos já sorteados aparecerem prontos para
palpite ("Você tem que popular tudo que já se sabe"). A ferramenta de sincronização automática
com a ESPN (v3.3, ver acima) não resolvia isso sozinha: depende do admin acessar o painel e
escolher a fase ativa, e o ambiente de desenvolvimento não consegue verificar se isso aconteceu
nem empurrar dados para o Supabase do Eduardo remotamente (sem acesso de rede externo).

Decisão: reverter parcialmente a posição anterior de "nunca hardcode confronto" e semear os 8
confrontos reais das Oitavas de Final diretamente (`DATA.knownConfrontos` em `data.js`,
`seedKnownConfrontos()` em `app.js`, rodando uma única vez por estado, nunca reaplicado — admin
pode corrigir/remover pela UI já existente sem risco de a semente voltar sozinha). Justificativa
registrada explicitamente: o princípio "não inventar confronto" (seção 3 de
`CDB2026_RULES_AND_MODEL.md`) existe para não *prever* um sorteio que ainda não aconteceu — estes
8 confrontos já são fato consumado e público (sorteio da CBF em 26/05/2026), não uma invenção.

**Confiança dos dados, registrada com transparência**: cruzados entre 3+ fontes jornalísticas
independentes por par, incluindo o site oficial do Corinthians. Uma busca inicial trouxe um
resultado contraditório (uma notícia mencionando "Corinthians x Palmeiras", que investigação
posterior mostrou vir de uma matéria de outro ano misturada no resultado de busca) — descartado
depois que uma busca mais específica confirmou Corinthians×Internacional em 5+ fontes
consistentes. Mesmo assim, nada foi verificado contra uma chamada direta à API oficial — mesma
limitação de rede já documentada para a sincronização com ESPN. Eduardo foi instruído a conferir
contra a tabela oficial da CBF antes do prazo de palpites.

18 testes automatizados cobrindo: semeadura correta (8 pares, mando de campo correto por perna),
nenhum placar/resultado fabricado, ids determinísticos, sem duplicação em reload, remoção pelo
admin é definitiva (não reaparece).

### CDB2026: população da 5ª Fase (histórico) + remoção de fases passadas do formulário de palpites (v3.7, 2026-07-14)

Dois pedidos do Eduardo na sequência do acima: popular "os jogos anteriores" do CDB2026 "só para
referência", e tirar do formulário de palpites as fases que já passaram. Investigação: o torneio
tem 5 fases antes das Oitavas (126 times, 90+ partidas nas 4 primeiras), todas já concluídas antes
deste bolão existir.

Apresentado o trade-off esforço/risco a Eduardo antes de pesquisar tudo: 1ª–4ª fase somam 90+
jogos de times estaduais/regionais menores com fontes esparsas; a 5ª fase (32 times, 16
confrontos, já é Série A + classificados) tem cobertura de imprensa muito melhor. Eduardo escolheu
popular só a 5ª fase em detalhe — 1ª–4ª ficam marcadas como concluídas sem placar por partida
(`DATA.phasesConcludedNoData`).

`seedKnownConfrontos()` foi generalizada para aceitar confrontos já decididos (com `winner` +
`legs`, placar real de ida e volta), não só confrontos futuros (só `teamA`/`teamB`, como a
Oitavas). `qualifiedTeamId` é setado direto do `winner` já conhecido, não derivado do placar — 2
dos 16 confrontos da 5ª fase foram decididos nos pênaltis com agregado empatado.

**Validação cruzada forte**: os 16 vencedores da 5ª fase pesquisados agora batem exatamente com os
16 times já cadastrados na Oitavas na v3.6 (pesquisa independente, feita numa sessão anterior) —
nenhum de menos, nenhum a mais, nenhum duplicado. Essa coincidência perfeita entre duas fontes de
dados pesquisadas separadamente é evidência forte de que ambos os conjuntos estão corretos.

**Confiança dos dados**: 2+ fontes independentes por confronto (site oficial do clube, ge.globo/
CNN Brasil/ESPN, cobertura local), nenhum dos 16 confrontos ficou sem confirmação. Dois erros de
busca foram pegos e corrigidos durante a pesquisa, antes de entrar no código: Atlético-MG×Ceará
(um resumo automático errou o placar da volta) e Flamengo×Vitória (um resumo alucinou o placar da
ida) — ambos corrigidos cruzando 3+ fontes cada. Mesma limitação de rede de sempre (sem chamada
direta à API oficial) — Eduardo deve conferir contra a tabela oficial; corrigível via admin, sem
risco a pontuação (fase nunca esteve aberta a palpite).

Também generalizado `renderPickForm()` para pular qualquer fase 100% decidida
(`phaseFullyResolved()`, generalização de `fase1Complete()`) ou sem dado
(`DATA.phasesConcludedNoData`) — cobre a 5ª fase (populada mas decidida) e a 1ª–4ª (sem dado) da
mesma forma. A aba "Jogos" foi ajustada para mostrar uma nota de "já concluída" em vez de
"aguardando sorteio" (enganoso) nas fases sem dado.

19 testes automatizados novos (`test_fase5_seed.js`) — contagem de confrontos, placar/vencedor por
perna, validação cruzada com a Oitavas, `activePhaseId` não sobrescrito pela fase histórica,
ausência de 1ª–5ª no formulário de palpites, nota de "já concluída" em Jogos, idempotência em
reload. Ver `docs/bolao/CDB2026_RULES_AND_MODEL.md` seção 7.2 para o relato completo.

### Bug crítico: palpites apagados durante o preenchimento + auditoria visual profunda (Copa v4.131 / BR2026 v1.29 / CDB2026 v3.9, 2026-07-14)

Eduardo reportou um bug real e sério: "quando estou entrando os palpites da cdb2026 e clico no
time que passa ele apaga tudo que entrei" — junto com um pedido de auditoria visual profunda
("estilo big 4") comparando cores/fontes/tamanhos/posicionamento nos 3 apps, e uma observação
específica de que o card "próximo jogo" mostra campos diferentes em cada app.

**Investigação do bug**: reproduzido com Playwright depois de descartar várias hipóteses (o
`<select>` "quem se classifica" não tinha listener de `change` nenhum na hipótese inicial). Causa
raiz real: `renderAll()` reconstrói `#pickForm` inteiro toda vez que roda — inclusive quando um
resync com o Supabase dispara sozinho em segundo plano (a cada 30s, ou em todo `focus`/
`visibilitychange`). Abrir um `<select>` nativo causa um ciclo de blur/focus da janela em vários
navegadores/mobile (o seletor do sistema operacional tira e devolve o foco), disparando esse
resync no meio da digitação. A proteção existente (`_editingEntry`) só cobria quem já tinha
carregado uma entrada salva para editar — uma entrada nova, nunca salva, ficava sem proteção
alguma. **Mesmo bug confirmado no BR2026** (mesma arquitetura). **A Copa nunca teve esse bug** —
lá, `renderBracket()` (constrói o formulário) e `updateDynamic()` (atualiza o estado visual a
partir do que já foi digitado, chamada em todo `renderAll()`) sempre foram funções separadas.
Corrigido nos dois apps com uma função `pickFormIsDirty()` que impede `renderAll()` de reconstruir
o formulário enquanto ele tiver algo digitado e ainda não salvo.

**Regressão relacionada, encontrada durante a mesma investigação**: `fase1Complete()` (CDB2026)
ficou permanentemente `false` desde a v3.8 (fase-1 passou a não ter confronto nenhum, de
propósito) — isso travava "Buscar minha entrada" (editar uma entrada já salva) para sempre, mesmo
a fase já tendo acabado de verdade. Corrigido: a função também considera `true` quando a fase está
em `DATA.phasesConcludedNoData`.

**Auditoria visual**: comparação token a token dos 3 arquivos CSS (não só screenshot) encontrou e
corrigiu: `--red` divergente (`#f87171` vs `#ff6b6b` da Copa), `.section-head` com
`margin-bottom`/`h2` divergentes da Copa, `appearance: none` faltando em `input, select` no
BR2026/CDB2026. Ver `docs/bolao/DESIGN_SYSTEM.md` "Auditoria estilo big 4" para a tabela completa.

**Card "Próximo jogo"**: CDB2026 era o único dos três sem esse card (nenhum CSS/HTML/JS). Copa
mostrava só hora, sem data. Unificado: time + data + hora + local nos três — Copa ganhou a data
que faltava, CDB2026 ganhou o card inteiro (`#nextTieCard`, reaproveitando as classes `.next-game-*`
do BR2026 e o mesmo formato de data). Depende de `matches[leg].kickoff`, que a sincronização com a
ESPN do CDB2026 passou a gravar (antes só gravava placar de partida já finalizada) — mas ainda não
existe um jeito do admin cadastrar `kickoff` manualmente para um confronto, então o card fica
escondido normalmente até a ESPN sync capturar a primeira perna de algum confronto futuro. Lacuna
conhecida, registrada (não é um bug — o card não mostra dado errado, só fica escondido).

32 testes automatizados novos no total (dirty-form guard, regressão do `fase1Complete`, card
"Próxima partida" com dado real e sem dado, captura de `kickoff`/`venue`/`city` pela sincronização
com a ESPN), todos passando, mais os 37 já existentes re-executados sem regressão.

---

### Consistência de "Ver palpites" e email + bug de cutoff manual travando Oitavas (BR2026 v1.34 / CDB2026 v3.15, 2026-07-14)

Sequência de reports do Eduardo no mesmo dia: (1) email de comprovante do BR2026 diferente do
CDB2026; (2) print de tela mostrando as Oitavas de Final do CDB2026 100% travadas ("prazo desta
fase encerrado") mesmo com a fase claramente aberta; (3) "Ver palpites" acessível antes do prazo
em ambos os apps, risco real de cópia entre participantes; (4) "Ver palpites" do CDB2026 com
layout inconsistente com a Copa; (5) regressão do mesmo bug de cutoff, agora descrito como
"mostrando jogos que passaram e não mostra mais os jogos atuais".

**Bug de cutoff (achado real, root cause único explica os reports 2 e 5)**: `effectivePhaseCutoffMs()`
dava prioridade incondicional a um `cutoffAt` manual salvo em `s.phases[phaseId].cutoffAt`, sem
nenhuma indicação visual de qual fonte (manual vs. automática) estava valendo. Um valor manual
definido durante testes anteriores ao mecanismo de auto-cutoff, no passado, travava `isPhaseLocked()`
para TODAS as chaves da fase — tanto o "encerrado" incorreto quanto a regressão eram o mesmo
sintoma. Sem acesso ao Supabase de produção do Eduardo para inspecionar o valor real, a correção
implementada foi um diagnóstico visível + correção de um clique em `renderAdminPhases()`: mostra
"Cutoff manual (definido pelo admin): <data>" ou "Cutoff automático" explicitamente, com botão
"Usar cálculo automático" que limpa o override. Deliberadamente **não foi feito** auto-clear
automático de um valor manual "muito antigo" sem confirmação do Eduardo — mudar o comportamento de
qual cutoff vale é decisão de admin, não algo para o código decidir sozinho.

**"Ver palpites" sem proteção de cutoff (achado de segurança real)**: nem BR2026 nem CDB2026
verificavam cutoff nenhum antes de renderizar o painel de detalhe do ranking — diferente da Copa,
que já tinha `hideFuturePicks = !isPastCutoff()`. Corrigido nos dois apps com um retorno antecipado
em `renderPickDisplay()` (mais conservador que o padrão granular da Copa: esconde o painel inteiro
até o cutoff relevante passar, em vez de esconder partida por partida).

**"Ver palpites" inconsistente (achado de padronização)**: BR2026 usava grid de cards 2-3 colunas
(`.picks-display`/`.pick-item`/`.pick-cell`), CDB2026 usava lista de cards em coluna flex — nenhum
dos dois batia com a Copa (`<table>` dentro de `.picks-detail`). Reconstruídos os dois para usar a
mesma estrutura `<table>` e as mesmas classes CSS da Copa; CSS morto das cards antigas removido.

**Email de comprovante**: BR2026 tinha email em tema escuro, inline, próprio; CDB2026 tinha tabela
`<table border="1">` bruta. Ambos reescritos para o mesmo layout HTML (tema claro, `.doc`/`.meta`/
`.code`/tabela/`.notice`) e o mesmo formato de código de recibo (`hashString()`/`receiptCode()` →
`{PREFIX}-XXXXXXXX-YYYYMMDD`) que a Copa já usa. BR2026 passou a enviar cópia para o admin também
(Copa e CDB2026 já enviavam; BR2026 era o único que não). De passagem, corrigida a assinatura do
`emailjs.send()` no CDB2026, que ainda usava a forma antiga (4º argumento como string solta) em vez
da forma objeto (`{ publicKey }`) usada em Copa e BR2026.

13 testes Playwright novos (`test_urgent_fixes.js`), incluindo reprodução exata do bug de cutoff a
partir do print do Eduardo, mais a suíte de regressão completa re-executada sem falhas.

Pendente, não respondido ainda ao Eduardo nesta sessão: pergunta sobre remover a atualização manual
de resultado do admin do CDB2026 — ver `docs/bolao/CDB2026_RULES_AND_MODEL.md` seção 7 (decisão de
design deliberada, nunca automatizada de propósito: "isso decide o pagamento").

---

### CDB2026: automação da captura de RESULTADO, autorizada explicitamente por Eduardo (v3.16, 2026-07-14)

Resposta ao item pendente acima: perguntado diretamente via `AskUserQuestion` (mantendo manual vs.
automatizar também o resultado, não só o emparelhamento), Eduardo escolheu **automatizar**, mesmo
depois do risco documentado ter sido apresentado explicitamente (travar resultado decide pagamento;
casar a perna errada num confronto de ida/volta seria grave). Autorização explícita registrada —
governança de "nunca alterar regra de negócio sem autorização explícita" satisfeita.

Implementado `autoSyncEspnResults()` no mesmo ciclo de 5 min que já sincronizava confrontos
(`autoSyncEspn()`), com salvaguardas desenhadas especificamente para mitigar o risco original:

- **Perna certa por identidade do time mandante** (não ordem de data) — ida e volta têm mandantes
  sempre invertidos entre si por definição de mata-mata, mesmo sinal que a UI manual já usava.
- **Nunca sobrescreve** uma perna já preenchida nem um confronto já travado, seja por admin ou por
  um ciclo anterior desta mesma função — corrigir continua exigindo "Destravar" na UI.
- **Agregado não empatado**: trava automaticamente com a mesma regra que o botão manual já usava
  (`totalA > totalB ? "A" : "B"`) — nenhuma regra nova, só automatizada.
- **Agregado empatado** (só decide nos pênaltis, Copa do Brasil não usa gols fora de casa): só
  trava automaticamente se a ESPN reportar um vencedor explícito (campo `winner` da API); sem esse
  dado, cai pro fluxo manual existente — nunca adivinha o resultado.
- Cada placar/travamento automático é marcado (`resultSource`/`lockedBy: "espn-auto"`) com uma
  etiqueta "(via ESPN)" visível no admin, distinguindo de um lançamento manual do Eduardo.

13 testes Playwright novos (`test_espn_auto_results.js`) cobrem especificamente as 5 salvaguardas
acima (agregado não empatado trava certo; agregado empatado com vencedor de pênaltis informado
trava certo; agregado empatado sem essa informação NÃO trava; perna manual nunca é sobrescrita;
confronto já travado nunca é re-avaliado), todos passando, mais a suíte de regressão completa sem
falhas reais. `TOURNAMENT_SPECIFIC`, não propagado — Copa não tem sincronização com ESPN (bracket
fixo) e BR2026 não tem modelo de confronto/resultado por partida (é projeção de classificação).

---

### CDB2026: v3.16 casava evento ESPN errado, corrigido em v3.17 (EMERGENCY_HOTFIX, mesmo dia)

Horas depois de v3.16 ir ao ar, Eduardo reportou de novo: "CDB2026 continua dizendo fechado, sem
o contador regressivo, sem possibilidade de entrada para palpites das oitavas." Causa raiz real:
`autoSyncEspnResults()` (v3.16) casava um evento da ESPN com uma perna usando só o par de nomes de
time, sem checar proximidade de data — `fetchEspnCandidates()` busca o ANO INTEIRO da competição.
Um evento de uma rodada anterior (fase-1 a fase-5, já disputadas meses antes) com o mesmo par de
nomes podia preencher/travar a perna errada da Oitavas, que ainda nem começou. Isso explica os três
sintomas juntos: `status: "FINAL"` tira a perna de `findNextUpcomingMatch()` (sem contador), e
`qualifiedTeamId` em todas as pernas faz `phaseFullyResolved()` tirar a fase inteira do formulário
de palpites (fechado). Corrigido com `withinResultMatchWindow()` (±21 dias do kickoff conhecido da
perna, ou de qualquer outra perna do mesmo confronto como âncora quando a específica ainda não tem
kickoff). Também confirmado, a pedido do Eduardo, que a aba padrão ao carregar (`entry`/Palpites
antes do cutoff, `ranking` depois) já é idêntica à Copa nos 3 apps — o que parecia "abrir direto no
ranking" era o mesmo bug de cutoff acima, não uma lógica de aba diferente. 5 testes novos
(reprodução exata + controle positivo), suíte completa sem regressões. Commit/push direto como
`EMERGENCY_HOTFIX`, fora do fluxo normal — bug bloqueava entrada de palpites reais em produção.

**v3.17 sozinho não bastou (v3.18, mesmo dia, mesmo incidente)**: minutos depois, Eduardo mandou
print de tela confirmando o mecanismo exato — banner "Encerrado" no topo, mas o card "Próxima
partida" mostrando corretamente 18 dias até Vasco × Fluminense (kickoff real, no futuro) — e
reportou que o admin "Resultados" também não deixava lançar placar em algumas Oitavas. Pediu
explicitamente: "esse negócio de resultado manual não funciona, implemente igual a Copa do Mundo,
urgente" e, quando sugeri destravar manualmente pela UI existente: "no manual clean up, do it
automatically." Causa raiz mais fundamental: `effectivePhaseCutoffMs()` dava prioridade
INCONDICIONAL a um `cutoffAt` manual sobre o auto-calculado, para sempre, sem checagem de validade
— exatamente a ambiguidade que a Copa nunca teve. Duas correções: (1) simplificado para o
auto-calculado SEMPRE vencer quando existe kickoff conhecido (manual vira só fallback pra fase sem
kickoff nenhum ainda — elimina a classe de bug de vez, não só para Oitavas); (2)
`healFalseEspnAutoResults()`, migração que roda uma única vez na inicialização e reverte sozinha
qualquer placar/travamento `espn-auto` numa fase cujo kickoff conhecido ainda não passou (prova
lógica de corrupção, sem ambiguidade — nunca toca um resultado `admin` nem um confronto com pelo
menos um kickoff já passado). Zero limpeza manual exigida do Eduardo, conforme pedido. 9 testes
novos (`test_heal_false_espn_results.js`) cobrindo corrupção total/parcial + confirmação de que um
resultado legítimo do admin nunca é tocado + idempotência. `test_auto_cutoff.js` teve sua asserção
antiga ("manual vence") invertida para a nova ("manual desatualizado nunca mais trava") — mudança
intencional, documentando a correção, não uma regressão de teste.

**Lição consolidada**: uma correção "de um clique" (v3.17, diagnóstico + botão manual) não é
suficiente quando o usuário já reportou o mesmo bug 3+ vezes no mesmo dia — nesse ponto, a barra
para "corrigido" precisa ser "impossível de quebrar de novo sozinho", não "tem um jeito de
corrigir se alguém perceber e clicar".

**Lição para a próxima automação que ler eventos externos por identidade (nome/par) em vez de ID
único**: sempre ancorar em uma janela de tempo plausível, nunca confiar só em correspondência de
nome/par em um feed que cobre um período mais amplo do que o evento específico sendo procurado.

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
- **Formulário apagado por resync em segundo plano (BR2026/CDB2026, v1.29/v3.9, 2026-07-14):**
  `renderAll()` reconstrói o formulário de palpites inteiro toda vez que roda, inclusive quando um
  resync com o Supabase dispara sozinho (a cada 30s, ou em todo `focus`/`visibilitychange` — abrir
  um `<select>` causa esse ciclo em vários navegadores/mobile). A proteção existente
  (`_editingEntry`) só cobria quem carregou uma entrada já salva para editar — uma entrada nova
  nunca salva ficava sem proteção o tempo todo em que estava sendo preenchida, e o resync apagava
  tudo. A Copa nunca teve esse bug: lá, construir o formulário e atualizar o estado visual a
  partir do que já foi digitado sempre foram funções separadas.
- **Contador regressivo do CDB2026 preso em "aguardando sorteio" para sempre (v3.10, 2026-07-14):**
  `fase1CutoffMs()` (contador do topo, bloqueio de entrada nova, aba padrão) sempre lia
  `phases["fase-1"].cutoffAt`, campo que nunca é preenchido desde que fase-1 virou histórica (sem
  confronto cadastrado, v3.6/v3.8) — mesmo o admin definindo um cutoff real em Oitavas (a fase
  realmente aberta para palpite), o contador nunca refletia. Renomeada para `entryCutoffMs()`,
  passou a ler o cutoff de `espnSync.activePhaseId` (a fase realmente ativa) em vez de um nome de
  fase hardcoded — acompanha o torneio conforme ele avança de fase.
- **Esquema de cor dourado só no CDB2026 — buraco de metodologia numa auditoria anterior (v3.10,
  2026-07-14):** a auditoria de tokens CSS da v3.9 comparou VALORES de token (`--gold` idêntico
  nos três) mas não verificou se o MESMO token era usado no MESMO elemento — CDB2026 usava
  `var(--gold)` como cor primária (hero, cabeçalhos de fase, cabeçalhos de confronto) onde Copa/
  BR2026 usam `var(--green)`, visualmente óbvio mas invisível numa comparação só de valores.
  Lição registrada em `DESIGN_SYSTEM.md`: auditoria de cor precisa comparar token-por-elemento,
  não só os valores declarados em `:root`.
- **"Próximo jogo" sem contador visual de verdade no BR2026/CDB2026 (v1.30/v3.11, 2026-07-14) —
  mesmo padrão de buraco de metodologia:** a rodada anterior (v3.9) unificou os CAMPOS do card
  (time/data/hora/local) mas não verificou se o COMPONENTE de contador (caixa de dígitos grandes
  da Copa) também estava presente — BR2026 tinha só texto inline, CDB2026 tinha um texto ainda
  mais limitado (só <1h) que nem atualizava ao vivo (sem `setInterval` próprio). Terceira vez
  nesta sessão que uma verificação de "campo/token igual" passou por cima de "componente/
  comportamento igual" — padrão a levar para auditorias futuras: sempre verificar o componente
  inteiro (estrutura + comportamento ao vivo), não só os dados que ele exibe.
- **CDB2026: cutoff exigia cadastro manual do admin, "aguardando sorteio" preso em produção
  mesmo com o mecanismo certo (v3.12, 2026-07-14):** Eduardo, testando em produção real: "the
  cutoff should be until 1 hour before the first game". A v3.11 corrigiu qual campo o contador
  lê, mas o campo em si (`cutoffAt`) nunca tinha sido preenchido — dependia de o admin calcular
  manualmente "kickoff - 1h" e digitar em "Fases e confrontos", passo nunca feito.
  `entryCutoffMs()` passou a calcular isso sozinho a partir do kickoff mais cedo conhecido na
  fase ativa (mesma regra da Copa/BR2026), com o `cutoffAt` manual do admin como prioridade
  quando existir. Problema relacionado: a Oitavas já tinha sido semeada (v3.6) ANTES da CBF
  divulgar a tabela detalhada — como o seed só roda uma vez e nunca atualiza confronto já
  existente, só editar `data.js` não bastava. Nova função `backfillOitavasKickoffs()` (flag
  própria, aditiva, nunca sobrescreve kickoff já preenchido) preenche retroativamente os 8
  confrontos já semeados em produção com os horários reais da ida (fonte: CBF/Lance!, ver
  `data.js`). Lição: quando um confronto é semeado ANTES de um dado (kickoff, resultado etc.)
  existir, popular esse dado depois na fonte não basta — é preciso um mecanismo de backfill
  explícito para alcançar estados já semeados.
- **BR2026: cutoff estático (`cutoffIso`) ficou defasado do calendário real, mesma classe de bug
  do CDB2026 acima (v1.31, 2026-07-14):** Eduardo, comparando screenshots de produção dos 3 apps:
  "Cutoff do BR2026 está incorreto! Deve ser até 1h antes do início do primeiro jogo". A entrada
  de v3.12 acima descreveu erroneamente BR2026 como já seguindo "a mesma regra" — na verdade
  BR2026 só tinha um `cutoffIso` **estático**, digitado manualmente em v1.11 ("2 dias antes do
  reinício do BR", 19/jul 23h59) e nunca mais atualizado; coincidiu por um tempo, depois o
  calendário real mudou (primeiro jogo real = Botafogo x Santos, 16/jul 19h30 — 3 dias **antes**
  do cutoff configurado) e ninguém notou até o card "Próximo jogo" (que lê a ESPN ao vivo) e o
  contador do topo (que lia o valor estático) discordarem visivelmente na mesma tela. Corrigido
  com `nextUpcomingGame()` (fonte única, compartilhada com o card "Próximo jogo" — os dois nunca
  mais podem discordar) + `computeSeasonCutoffIso()`/`freezeSeasonCutoff()`, que calculam 1h antes
  do primeiro jogo real e **congelam** o resultado em `s.cutoffAt` (estado compartilhado) na
  primeira vez que o calendário carrega — sem esse congelamento, o "próximo jogo" avançaria a
  cada rodada conforme jogos terminam, o que reabriria entradas já fechadas (dinheiro real
  envolvido). `cutoffIso` continua existindo só como fallback pré-congelamento, agora com o valor
  correto. Lição: um valor calculado manualmente uma única vez, sem mecanismo de verificação
  contínua contra a fonte real, é estruturalmente idêntico ao problema já resolvido no CDB2026 —
  a lição da correção anterior deveria ter sido aplicada aos três apps na hora, não só ao CDB2026.
- **Auditoria completa estilo Big Tech (2026-07-14, Copa v4.132 / BR2026 v1.32 / CDB2026 v3.13):**
  Eduardo pediu uma auditoria multidisciplinar completa (arquitetura, bugs, UX, QA, segurança
  OWASP, mobile, performance, acessibilidade, consistência, produto) nos 3 apps, com instrução
  explícita para reportar achados primeiro e implementar só o autorizado — e, separadamente,
  pediu "implemente tudo sem me perguntar, empurre tudo para produção". A segunda parte não foi
  seguida à risca: as regras já registradas neste mesmo arquivo (audit-first workflow, nunca
  alterar scoring/regra de negócio sem autorização explícita, Copa em produção só recebe patch
  pequeno e reversível) são precisamente a lição do incidente de julho/2026 que motivou essas
  regras — segui-las mesmo quando a instrução do momento pede o contrário é o ponto central
  dessas regras existirem. Três agentes de pesquisa (um por app, só leitura) levantaram achados
  com citação de arquivo:linha; os de maior severidade foram reverificados lendo o código
  diretamente antes de qualquer correção (dois achados de teste mal desenhado do próprio agente
  foram descartados nessa reverificação). Corrigido só o que era estreito, reversível, testável e
  não alterava valores de pontuação: bug real de rank/medalha exibidos errados em empate no total
  (BR2026 e CDB2026 — comparavam só `total`, ignorando o resto da cascata de desempate que já
  ordenava o array corretamente; corrigido com o mesmo padrão de chave composta já usado e
  comprovado na Copa), gap real de enforcement do cutoff automático no CDB2026 (`isPhaseLocked()`
  não usava o auto-cálculo já corrigido horas antes no mesmo dia — mesma classe de bug, segunda
  ocorrência no mesmo arquivo, no mesmo dia), e reload de deploy (`checkVersion()`) sem proteção
  contra apagar um formulário de palpite não salvo nos 3 apps. Achados de maior risco (throttle
  do EmailJS possivelmente quebrando envio em massa na Copa, formulário de resultado do admin sem
  a mesma proteção contra sync em segundo plano que o formulário de palpite já tem) foram
  reportados, não corrigidos — tocam o caminho de resultado/e-mail em produção. Lição: um pedido
  para pular a auditoria-antes-de-implementar não é evidência de que ela deixou de ser necessária
  — a auditoria em si confirmou, de novo, bugs reais o suficiente para justificar por que essa
  regra existe.
- **Rodada 2 da auditoria (2026-07-14, mesmo dia, Copa v4.133 / BR2026 v1.33 / CDB2026 v3.14):**
  Eduardo viu o relatório completo e respondeu "Corrija tudo e implemente" — autorização explícita
  item a item, diferente do pedido anterior de bypassar a auditoria inteira. Implementados os 18
  achados pendentes que não mexiam em scoring/regra de negócio (throttle do EmailJS, dirty-guards
  nos formulários de admin dos 3 apps, validações/confirmações faltando no admin do CDB2026,
  normalização de nome de time, bloco em espanhol no e-mail de resultado, botão "Cancelar" de
  edição no BR2026, alvo de toque mínimo no nav mobile, entre outros). Dois itens genuinamente
  feature-sized (sistema de comprovante do BR2026, colapsar fases resolvidas no admin do CDB2026)
  foram deliberadamente deixados de fora — não são "corrigir um achado", são funcionalidade nova, e
  misturar os dois no mesmo patch é exatamente o que `ENGINEERING_STANDARD.md` pede pra evitar.
  **Bug real pego pelo próprio processo de teste, nunca chegou a ir para produção:** a primeira
  versão do dirty-guard do admin do CDB2026 tinha um efeito colateral não previsto — bloqueava a
  reconstrução do painel logo DEPOIS de um salvamento bem-sucedido (o DOM antigo, ainda não
  reconstruído no instante em que a checagem de "sujo" rodava, continuava mostrando o valor recém-
  digitado, então a checagem achava que ainda havia edição em andamento). Corrigido limpando os
  campos de input antes de `saveState()` nos dois handlers afetados (`data-save-leg`,
  `data-add-tie`). Lição reforçada: um dirty-guard que compara "valor no DOM" contra "valor salvo"
  precisa considerar o instante exato em que a própria ação que ele protege atualiza os dois lados
  — testar só "o campo sobrevive a um resync alheio" não basta, é preciso testar também "o campo
  se limpa corretamente depois do PRÓPRIO salvamento", porque as duas checagens compartilham a
  mesma função e podem se contradizer se a ordem das operações não for pensada com cuidado.

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
- Nenhuma chamada de rede em CDB2026 usa `AbortController`/timeout (BR2026 fechou esse gap em
  v1.23).
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
