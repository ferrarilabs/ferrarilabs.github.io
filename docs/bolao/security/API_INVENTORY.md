# API Inventory — Plataforma Bolão

Revisão somente leitura, 2026-08-02. Escopo: `bolao/copa2026/`, `bolao/br2026/`, `bolao/cdb2026/`,
`bolao/loterias/powerball/`, `bolao/` (raiz/redirects). Método: leitura de código
(`js/config.js`, `js/app.js`, `scripts/*.py`, `.github/workflows/*.yml`) + testes passivos
(GET/SELECT) contra os endpoints reais listados, usando somente a chave `anon`/`publishable` já
pública no bundle do navegador. Nenhuma chamada de escrita foi feita contra produção. Chaves
mascaradas em todo o documento.

Projeto Supabase real usado pelos três apps: `cmhqkkfczotdnssupkni.supabase.co` (mesmo projeto,
mesma tabela `bolao_state`, uma linha por app via coluna `id`).

## Tabela mestre

| Serviço | Endpoint / base URL | Chamado por | Métodos | Dados enviados | Dados recebidos | Autenticação | Chave exposta? | Escrita? | Risco | Necessário? |
|---|---|---|---|---|---|---|---|---|---|---|
| Supabase Data API (PostgREST) | `https://cmhqkkfczotdnssupkni.supabase.co/rest/v1/bolao_state` | `js/app.js` (`loadRemoteState`/`saveRemoteState`) nos 3 apps; `scripts/*.py` (backup, send_result_email, auto_reopen, send_bracket_correction_email) | GET, POST (upsert), PATCH (via app código; ver nota) | Estado JSON completo do app (entries, paid, results, auditLog, phases…) | Linha completa (`id`, `state` jsonb, `updated_at`) | Header `apikey` + `Authorization: Bearer <anon>` — mesma chave anon nos 3 apps e nos scripts Python | Sim — `sb_publishable_9eJs…5` (mascarada), idêntica nos 3 `config.js` e em todo `scripts/*.py` | Sim (INSERT/UPDATE, `id in ('main','br2026','cdb2026')`, ver `SUPABASE_SECURITY_REVIEW.md`) | Alto (linha JSON única mutável pelo mesmo papel que lê) | Sim — é a única persistência remota da plataforma |
| Supabase Data API — introspecção OpenAPI | `https://…supabase.co/rest/v1/` (sem path de tabela) | Ninguém no código do app; testado manualmente nesta auditoria | GET | — | Schema (se permitido) | apikey | N/A | Não | Baixo | N/A — testado só para auditoria |
| EmailJS | `https://api.emailjs.com/api/v1.0/email/send` | `js/app.js` (`mailReceipt`) nos 3 apps; `scripts/send_result_email.py`, `send_round_email.py`, `send_bracket_correction_email.py` | POST | `service_id`, `template_id`, `user_id` (public key), `template_params` (html_message já escapado, to_email, entry_name, receipt_code) | Status de envio | Chave pública (`user_id`) — sem segredo server-side no fluxo browser | Sim — `GBZFujsJBET6modve` (pública por design do produto EmailJS) | Sim (envio de e-mail é a única "escrita" possível com essa chave) | Médio (spam/abuso, não vazamento de dado — ver `RATE_LIMIT_POLICY.md`) | Sim |
| ESPN (não oficial) — standings | `https://site.api.espn.com/apis/v2/sports/soccer/bra.1/standings` | `bolao/br2026/js/app.js` (poll 60s) | GET | Nenhum (query pública) | Classificação do Brasileirão | Nenhuma (API pública sem chave) | N/A | Não | Baixo/Médio (dado externo não autenticado, ver `INJECTION_REVIEW.md`/seção 14 do relatório) | Sim (fonte de standings ao vivo) |
| ESPN — scoreboard/schedule (BR2026) | `https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard[?dates=...]` | `bolao/br2026/js/app.js`, `bolao/br2026/scripts/send_round_email.py` | GET | Nenhum | Placares, calendário | Nenhuma | N/A | Não | Baixo/Médio | Sim |
| ESPN — scoreboard (CDB2026) | `https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_brazil/scoreboard?dates=...` | `bolao/cdb2026/js/app.js`, `bolao/cdb2026/scripts/send_result_email.py` | GET | Nenhum | Placares Copa do Brasil | Nenhuma | N/A | Não | Baixo/Médio | Sim |
| ESPN — scoreboard/summary (Copa) | `https://site.api.espn.com/apis/site/v2/...` (Copa do Mundo, endpoints legados no app arquivado) | `bolao/copa2026/js/app.js`, `bolao/copa2026/scripts/send_result_email.py` | GET | Nenhum | Placar, relógio, artilheiros, probabilidade | Nenhuma | N/A | Não | Baixo (app arquivado, só leitura histórica) | Não mais crítico (torneio encerrado) |
| API-Football (api-sports.io) | `https://v3.football.api-sports.io` | `bolao/copa2026/js/app.js` (`apiFootball`) | GET | `apiKey` no header (se configurada) | Resultados | API key própria | **Desabilitada por padrão nos 3 apps** (`enabled:false`, `apiKey:""`) | Não (leitura) | Médio **se habilitada** — chave ficaria exposta no bundle do navegador sem proxy | Não obrigatório hoje |
| Polymarket Gamma API | `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100` | `bolao/copa2026/js/app.js` (`autoFill("smart")`, uso interno, sem UI dedicada) | GET | Nenhum | Eventos/probabilidades públicas | Nenhuma | N/A | Não | Baixo | Opcional (só Copa) |
| NY Open Data (Socrata) — Powerball | `https://data.ny.gov/resource/d6yy-54nr.json` | `bolao/loterias/powerball/js/app.js`/`data.js` | GET | Nenhum | Resultados de sorteios | Nenhuma | N/A | Não | Baixo | Sim |
| NY Open Data (Socrata) — Mega Millions | `https://data.ny.gov/resource/5xaw-6ayf.json` | `bolao/loterias/powerball/js/data.js` (referência, uso condicional) | GET | Nenhum | Resultados | Nenhuma | N/A | Não | Baixo | Condicional |
| CDN — jsDelivr (`@emailjs/browser@4`) | `https://cdn.jsdelivr.net/...` | `index.html` dos 3 apps bolão | GET (script load) | Nenhum | Bundle JS assinado (SRI) | N/A | N/A | Não | Baixo (SRI fixado) | Sim |
| CDN — jsDelivr (`@supabase/supabase-js@2`) | `https://cdn.jsdelivr.net/...` | `index.html` dos 3 apps bolão | GET (script load) | Nenhum | Bundle JS assinado (SRI) | N/A | N/A | Não | Baixo (SRI fixado) | Sim |
| Cloudflare Turnstile | `https://challenges.cloudflare.com/turnstile/v0/api.js` | `index.html`/`index.pt.html`/`index.es.html`/`index.jp.html` (site principal, **não** bolão) | GET (script) + POST server-side (Formspree valida) | site key pública (`0x4AAAAAADBOZDvkES97y2fW`) | Token de desafio | Site key pública | Sim (esperado — site key não é segredo) | Não (do lado do cliente) | Baixo | Sim (anti-spam do formulário de contato) |
| Formspree | `https://formspree.io/f/xvzdwenk` | `index.html`/`index.pt.html`/`index.es.html`/`index.jp.html` (site principal) | POST (form submit) | Nome, e-mail, mensagem do formulário de contato | Confirmação | Endpoint ID público (não é uma chave secreta) | Sim (por design do produto) | Sim (única escrita do site principal) | Baixo | Sim |
| GitHub Actions — `auto_results.yml` | Runner GitHub-hospedado | Cron + `workflow_dispatch` | Executa `send_result_email.py`/`auto_reopen.py` (que chamam Supabase + EmailJS acima) | N/A (CI) | N/A | `secrets.GITHUB_TOKEN` (só para commit/push do próprio repo) | Token do GH Actions nunca exposto ao navegador | Sim — indiretamente (o script escreve no Supabase com a mesma chave anon) | Médio (ver `SESSION_AND_TOKEN_SECURITY.md`/nota sobre automação usando chave anon) | Sim |
| GitHub Actions — `br2026_round_emails.yml` | Runner GitHub-hospedado | Cron + `workflow_dispatch` | Executa `send_round_email.py --auto` | N/A | N/A | Nenhum secret customizado declarado no workflow | N/A | Sim (indireto) | Médio | Sim |
| GitHub Actions — `cdb2026_result_emails.yml` | Runner GitHub-hospedado | Cron + `workflow_dispatch` | Executa `send_result_email.py` (CDB2026) | N/A | N/A | Nenhum secret customizado declarado | N/A | Sim (indireto) | Médio | Sim |
| GitHub Actions — `sync_version.yml` | Runner GitHub-hospedado | Push em `bolao/**/js\|css/**` | Reescreve `?v=` nos 4 `index.html` | N/A | N/A | `secrets.GITHUB_TOKEN` | N/A | Sim (só no próprio repo, commit de cache-bust) | Baixo | Sim |
| GitHub Pages (hosting) | `ferrarilabs.github.io` / `www.ferrarilabs.com` (custom domain, redirect 301 confirmado nesta auditoria) | Todo o site | GET (estático) | N/A | HTML/JS/CSS estáticos | Nenhuma | N/A | Não | Baixo | Sim |

## Serviços configurados mas não usados / notas

- **Supabase Auth**: não utilizado em nenhum app. Não há `supabase.auth.*` no código. Confirmado
  por busca em `js/app.js` dos 3 apps.
- **Supabase Realtime**: não utilizado. Sincronização é por polling/`focus`/`visibilitychange`,
  não por `supabase.channel()`/websocket. Roadmap `M-02` menciona isso como não implementado.
- **Supabase Storage**: não utilizado. Nenhum upload de arquivo pela plataforma.
- **Supabase Edge Functions**: não utilizado. Nenhuma função serverless própria em nenhum dos
  três apps — toda automação roda em GitHub Actions com scripts Python chamando a Data API
  diretamente com a chave anon (ver `SESSION_AND_TOKEN_SECURITY.md` para a implicação disso).
- **Analytics**: `gtag(...)` referenciado no formulário de contato do site principal
  (`onsubmit="gtag('event', ...)"`) — mas nenhuma tag/script do Google Analytics foi encontrado
  carregado em `index.html` nesta revisão; o `gtag` chamado sem o script carregado resultaria em
  erro silencioso (`gtag is not defined` engolido, ou lançado — não testado em runtime real).
  Registrado como observação, não como vulnerabilidade de segurança.
- **`.htaccess`** em `bolao/loterias/powerball/.htaccess`: define headers de cache Apache
  (`Cache-Control`, `Pragma`, `Expires`). **GitHub Pages não processa `.htaccess`** (não é
  Apache) — este arquivo é inerte na hospedagem real. Não é um risco de segurança, mas é
  configuração morta; não documentar como controle ativo em nenhum relatório futuro.
- **`bolao/sw.js`** (raiz): mantido deliberadamente como rede de segurança para navegadores com o
  Service Worker antigo `/bolao/`-scoped ainda registrado — ver `CLAUDE.md` "Copa do Mundo 2026
  archive". Não expõe endpoint novo, apenas intercepta cache do próprio site.
- **`bolao/loterias/powerball/js/data.js`**: não é uma "API" no sentido de rede, mas é um dado
  publicamente servido que merece nota aqui — contém nome completo e ID de transação real
  (Zelle/Venmo/CashApp) dos 14 participantes reais deste bolão, hardcoded em texto puro. Sem
  Supabase/RLS/chave alguma protegendo — a única barreira é `robots: noindex,nofollow,noarchive`
  + aviso de "página privada" na UI (obscuridade, não controle de acesso). Ver
  `docs/bolao/security/SECURITY_RISK_REGISTER.md` SR-14 para a classificação de risco completa.

## Superfície de rede por app (usada para validar o `connect-src` do CSP de cada um)

| App | Domínios externos chamados |
|---|---|
| Copa (`bolao/copa2026/`) | `api.emailjs.com`, `*.supabase.co`, `gamma-api.polymarket.com`, `v3.football.api-sports.io` (desabilitado), `api.ipify.org`, `cdn.jsdelivr.net`, `site.api.espn.com`/`espncdn.com` |
| BR2026 (`bolao/br2026/`) | `api.emailjs.com`, `*.supabase.co`, `site.api.espn.com`/`espncdn.com`, `cdn.jsdelivr.net` |
| CDB2026 (`bolao/cdb2026/`) | `api.emailjs.com`, `*.supabase.co`, `site.api.espn.com`, `cdn.jsdelivr.net` |
| Loterias/Powerball | `data.ny.gov`, `wa.me` (apenas link de compartilhamento, não `fetch`) |
| Site principal | `formspree.io`, `challenges.cloudflare.com` |

Cada app's CSP `connect-src` foi comparado a esta lista em `docs/bolao/security/SECURITY_ASSESSMENT_REPORT.md`
(seção "Headers e segurança do front-end").
