# Consistency Matrix — Plataforma Bolão

Este arquivo é gerado/mantido por auditoria automatizada (ver `PLATFORM_GOVERNANCE.md`).
Conteúdo manual pode ser adicionado **fora** do bloco `AUTO:CONSISTENCY_MATRIX` abaixo —
o bloco em si é substituído inteiramente a cada auditoria.

<!-- AUTO:CONSISTENCY_MATRIX:START -->
## Snapshot da auditoria

Comparação feita entre os três aplicativos reais no estado de código correspondente a:

> **ATENÇÃO (atualizado em 2026-08):** a tabela abaixo e os itens numerados desta matriz foram
> escritos em versões MUITO anteriores às atuais e várias afirmações já não descrevem o código.
> A auditoria de 2026-08 (`docs/bolao/CDB2026_CODE_AUDIT_2026-08.md`) confirmou, lendo o código,
> que pelo menos estas afirmações da matriz estão **erradas hoje**: que o CDB2026 não teria
> detecção de jogo adiado (item 25 — existe desde a v3.54: `postponed`, `isLegPostponed`, i18n
> `gamePostponed`) e que não teria auditor de pontuação (`bolao/cdb2026/scripts/audit_scoring.py`
> existe e passa 5/5). **Antes de usar qualquer linha desta matriz como lista de trabalho,
> confirme contra o código atual** — a ordem de fonte de verdade é: código > testes > estado
> persistido > UI publicada > documentação recente > documentação histórica. As linhas antigas
> foram mantidas de propósito como registro histórico, não como pendências.

| App | Pasta | siteVersion (2026-08) | Status |
|---|---|---|---|
| Copa do Mundo 2026 | `bolao/copa2026/` | v4.161 | **Encerrada e arquivada** (movida de `bolao/` em 2026-07-19; `/bolao/` redireciona para o BR2026) |
| Brasileirão 2026 | `bolao/br2026/` | v1.79 | **Em produção** |
| Copa do Brasil 2026 | `bolao/cdb2026/` | v3.55 | **Em produção** |

<details>
<summary>Estado no momento em que esta matriz foi originalmente escrita (histórico)</summary>

| App | Pasta | siteVersion | Status |
|---|---|---|---|
| Copa do Mundo 2026 | `bolao/` | v4.125 | Em produção |
| Brasileirão 2026 | `bolao/br2026/` | v1.14 | Não publicado |
| Copa do Brasil 2026 | `bolao/cdb2026/` | v2.0 | Não publicado |

</details>

Status possíveis: `CONSISTENT`, `INTENTIONALLY_DIFFERENT`, `MISSING`, `OUTDATED`, `NEEDS_REVIEW`, `CRITICAL_DIVERGENCE`.
Severidades: `Critical`, `High`, `Medium`, `Low`.

## Matriz

| # | Área/Feature | Copa do Mundo | BR2026 | CDB2026 | Deve ser igual? | Status | Divergência encontrada | Severidade | Ação recomendada |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Scoring self-audit script | `audit_scoring.py` valida bracket/scoring antes de cada envio | Nenhum script equivalente | Nenhum script equivalente | Sim (mesmo padrão de proteção) | NEEDS_REVIEW | BR2026/CDB2026 movimentam dinheiro real (US$5/entrada) mas não têm auditoria automatizada de scoring como a que evitou o incidente de julho/2026 na Copa | High | Antes de publicar BR2026/CDB2026, criar auditoria equivalente ou explicitamente documentar por que não é necessária |
| 2 | Admin password hash | `a6b9c8...138dee6` | mesmo hash | mesmo hash | Decisão do produto | INTENTIONALLY_DIFFERENT | Os três apps compartilham a mesma senha de admin — comprometer uma credencial compromete os três painéis | Medium | Registrar como decisão consciente; considerar hashes distintos por app antes de publicar os outros dois |
| 3 | Admin lockout (5 tentativas / 15 min) | `sessionStorage["adminLockUntil"]` | `sessionStorage["br2026_loginLockUntil"]` | `sessionStorage["cdb2026_loginLockUntil"]` | Sim | CONSISTENT | Implementação equivalente nos três. `docs/bolao/SECURITY.md`/`REQUIREMENTS.md` descreviam o mecanismo como `localStorage` — corrigido para `sessionStorage` (Issue #146, 2026-08-18), agora consistente com `ARCHITECTURE.md`/`PROJECT_MEMORY.md` | Medium | Resolvido |
| 4 | Sessão admin (30 min) | `sessionStorage`, `guardAdmin()` em toda ação | idêntico padrão | idêntico padrão | Sim | CONSISTENT | Nenhuma | — | — |
| 5 | Login/logout admin | Form + botão, `sha256Hex()` | mesmo padrão (`sha256hex()`) | mesmo padrão | Sim | CONSISTENT | Nomes de função diferem em capitalização apenas (`sha256Hex` vs `sha256hex`) | Low | Nenhuma ação necessária, é interno |
| 6 | Admin toolbar — nº de ações | 13 botões (CSV completo, Master CSV, Master HTML, JSON backup, Demo, API-Football, ESPN sync, e-mail teste, e-mail a todos, sync remoto, limpar tudo) | 2 botões (CSV, Sync) | 2 botões (CSV, Sync) | Não necessariamente | INTENTIONALLY_DIFFERENT | BR2026/CDB2026 ainda não têm as ferramentas administrativas avançadas da Copa | Low | Avaliar quais ferramentas fazem sentido antes de publicar (ex.: exportação, limpar dados) |
| 7 | Botão "Limpar tudo" (clear data) | Presente (`clearData`, classe `danger`) | Ausente | Presente desde v2.0 (`clearDataBtn`, classe `danger`, mesma confirmação dupla) | Recomendado para paridade mínima de administração | NEEDS_REVIEW | CDB2026 resolvido em v2.0; BR2026 ainda sem o botão | Medium | Portar para BR2026, ou documentar procedimento manual via Supabase como já existe para a Copa |
| 8 | Comprovante (receipt) individual | Sistema completo: código `BOLAO-XXXXXXXX-YYYYMMDD`, popup Blob URL, download HTML, envio por e-mail | **Nenhum sistema de comprovante** | Implementado em v2.0: código `CDB2026-XXXXXXXX-YYYYMMDD` (mesmo algoritmo FNV-32/`hashString` da Copa), exibido na tela + no e-mail de confirmação. Sem popup/download HTML — só exibição em tela e e-mail | Sim, dado que "comprovantes servem como evidência operacional" está no disclaimer dos três apps | NEEDS_REVIEW | CDB2026 resolvido (formato de código alinhado com a Copa); BR2026 ainda promete comprovante no disclaimer mas não gera nenhum | High | Portar comprovante para BR2026; avaliar se vale adicionar popup/download HTML ao CDB2026 para paridade total com a Copa |
| 9 | PDF / impressão de comprovante | Via popup Blob (print to PDF) | Ausente (não há comprovante) | Ausente — CDB2026 tem comprovante (item 8) mas sem fluxo de popup/impressão ainda | Consequência do item 8 | NEEDS_REVIEW | — | High | Ver item 8 |
| 10 | E-mail ao participante | EmailJS, template `template_xq7yzzb`, HTML do comprovante | Não implementado (sem comprovante) | Implementado em v2.0 — mesmo template/serviceId da Copa, corpo inclui código do comprovante + palpites de pódio + confrontos | Consequência do item 8 | NEEDS_REVIEW | CDB2026 resolvido; BR2026 ainda ausente | High | Portar para BR2026 |
| 11 | E-mail ao admin (notificação) | Template `template_4sgp5r9`, botões de teste e envio em massa | Config presente mas sem UI de envio dedicada | Config presente mas sem UI de envio dedicada | Não necessariamente | NEEDS_REVIEW | Config EmailJS existe mas fluxo de notificação ao admin não está exposto na UI | Low | Avaliar necessidade antes de publicar |
| 12 | EmailJS — chaves/config | `publicKey`, `serviceId`, templates idênticos | idêntico | idêntico | Sim | CONSISTENT | Nenhuma | — | — |
| 13 | EmailJS — rate limit (throttle) | `limitRateMs: 30000`, checado em `emailjs.init` | mesmo valor, checado manualmente (`_lastEmailTs`) | mesmo valor, checado manualmente (`_lastEmailTs`) | Sim | CONSISTENT | Nenhuma funcional | — | — |
| 14 | CSV export — quebra de linha | `\r\n` (CRLF, compatível com Excel) — decisão deliberada documentada no CHANGELOG v3.0 | `\n` (LF) | `\r\n` (corrigido em v2.0) | Sim, é um bug já corrigido uma vez na Copa | NEEDS_REVIEW | CDB2026 corrigido; BR2026 ainda reintroduz o problema de LF já corrigido na Copa | Medium | Alinhar `exportCsv()` de BR2026 para usar `\r\n` |
| 15 | CSV — nº de variantes | 2 (Master CSV resumido + Backup CSV completo com todos os palpites) | 1 (`exportCsv()` único) | 1 (`exportCsv()` único) | Não necessariamente | INTENTIONALLY_DIFFERENT | Apps menores, menos dados por entrada | Low | Nenhuma ação necessária no momento |
| 16 | JSON backup (estado completo) | Botão dedicado `backupJson` | Ausente | Presente desde v2.0 (`exportJsonBtn`) | Recomendado | NEEDS_REVIEW | CDB2026 resolvido; BR2026 ainda sem exportação de backup JSON bruto | Medium | Portar para BR2026 — é a rede de segurança citada no disclaimer |
| 17 | Master HTML (tabela para impressão) | Botão dedicado `masterHtml` | Ausente | Ausente | Não necessariamente | INTENTIONALLY_DIFFERENT | Feature de conveniência, não crítica | Low | Avaliar demanda antes de publicar |
| 18 | Dados de demonstração (seed) | Botão "Popular dados de teste" (3 entradas demo) | Ausente | Ausente | Não necessariamente | INTENTIONALLY_DIFFERENT | — | Low | Nenhuma ação necessária |
| 19 | Supabase — URL/anon key | Mesma URL e mesma anon key | idêntico | idêntico | Sim | CONSISTENT | Nenhuma — chave anon é pública por design | — | — |
| 20 | Supabase — isolamento por linha (`stateId`) | `id="main"` | `id="br2026"` | `id="cdb2026"` | Sim | CONSISTENT | Nenhuma; RLS deve restringir cada app à própria linha | — | — |
| 21 | Supabase — `database.enabled` | `true` | `false` (aguardando criação da linha) | ~~`false` (aguardando criação da linha)~~ → **DESATUALIZADO (2026-08): `true`** — CDB2026 está publicada e em produção desde 2026-07-19, `database.enabled: true` em `config.js` | Esperado dado que não estão publicados | NEEDS_REVIEW | Item escrito antes da publicação do CDB2026; BR2026 segue como estava | — | Confirmar BR2026 antes de publicá-lo também |
| 22 | Estratégia de merge (local-first) | `mergeStates()` — union de entries, local-wins em paid/results | `mergeStates()` equivalente | ~~`mergeStates()` equivalente~~ → **DESATUALIZADO (2026-08): NÃO é local-wins.** Após AUDIT-02 (Fase 1) e Fase 2.1 §2: entries por mais recente (`updatedAt`), `paid` any-true-wins (nem local nem remoto vencem incondicionalmente), resultado oficial/`ties` remote-wins (`preferRemoteResults: true`), e mutação administrativa dirigida (`applyAdminMutation`) que não usa nenhuma dessas regras — aplica o valor explícito do admin por cima do remoto mais recente. Ver `docs/bolao/adr/ADR-002-state-merge-strategy.md` | Sim | NEEDS_REVIEW | CDB2026 corrigido nas Fases 1/2/2.1; verificar se a descrição de BR2026/Copa também está desatualizada | — | Auditar BR2026/Copa antes de assumir "equivalente" |
| 23 | Sincronização multi-tab | `visibilitychange` **e** `focus` | apenas `visibilitychange` (dispara `checkVersion()`) | apenas `visibilitychange` (dispara `checkVersion()`) | Sim | NEEDS_REVIEW | BR2026/CDB2026 não re-sincronizam ao focar a aba, só ao trocar de visibilidade | Low | Adicionar listener de `focus` para paridade, se o padrão da Copa for considerado o correto |
| 24 | Live scores / API externa | ESPN (site/sports API) + API-Football (desabilitado) + Polymarket | ESPN (standings/scoreboard/schedule, poll 60s) | ~~**Nenhuma API externa** — dados estáticos em `js/data.js`~~ → **DESATUALIZADO (2026-08): usa ESPN** — `fetchEspnCandidates()`, `autoSyncEspn()`/`autoSyncEspnResults()`, poll de 60s no card ao vivo, igual ao padrão do BR2026 (item já era falso desde a v3.x, bem antes desta modernização) | Não necessariamente (depende do formato do torneio) | CONSISTENT | CDB2026 acabou convergindo para o mesmo padrão do BR2026 | — | — |
| 25 | Detecção de jogo adiado (postponed) | Implementado (`postponed` hint + i18n `matchPostponed`) | Implementado (`.game-status.postponed`, i18n `gamePostponed`) desde v1.13 | ~~**Não implementado**~~ → **DESATUALIZADO: implementado desde v3.54** (`postponed`, `isLegPostponed()`, i18n `gamePostponed`). A v3.55 ainda estendeu a guarda para o caminho de ESCRITA da sincronização ESPN (AUDIT-06) | Sim, mata-mata é sensível a adiamentos | NEEDS_REVIEW | CDB2026 não tem nenhuma forma de sinalizar jogo adiado | Medium | Portar a lógica de BR2026 (v1.13) para CDB2026 antes de publicar |
| 26 | Cache de API externa | `localStorage["bolao_api_football_cache"]`, TTL 60min | cache implícito via poll 60s (não persistido) | N/A (sem API) | Não necessariamente | INTENTIONALLY_DIFFERENT | Estratégias diferentes por natureza da fonte de dados | — | — |
| 27 | Cutoff — enforcement | Client-side, `isPastCutoff()` | idêntico padrão | idêntico padrão | Sim | CONSISTENT | Nenhuma | — | — |
| 27b | Cutoff — fonte do valor | `cutoffIso` estático em `data.js` (bracket fixo, datas conhecidas com anos de antecedência via calendário oficial FIFA) | `s.cutoffAt` auto-calculado (1h antes do 1º jogo real do calendário ESPN) e **congelado** uma vez (v1.31) — `cutoffIso` só fallback pré-congelamento | `cutoffAt` por fase, auto-calculado (1h antes do 1º kickoff conhecido na fase ativa, v3.12), `cutoffAt` manual do admin como prioridade | Não — mecanismos diferentes por design (ver nota abaixo), mas a REGRA de negócio ("1h antes do primeiro jogo") é a mesma nos 3 | INTENTIONALLY_DIFFERENT | Ver nota "Cutoff — fonte do valor" abaixo | — | — |
| 28 | Cutoff — rótulo customizado | `cutoffLabel` no config | calculado/exibido via `toLocaleString` direto, sem campo de config dedicado | idem BR2026 | Não necessariamente | INTENTIONALLY_DIFFERENT | — | Low | — |
| 29 | Countdown timer | `#countdown` + segundos, colapsável (`heroToggle`) | `#cutoffCountdown`, hero não colapsável | `#cutoffCountdown`, hero não colapsável | Não necessariamente (UX) | INTENTIONALLY_DIFFERENT | IDs e comportamento (toggle) diferentes | Low | Avaliar se o toggle do hero deveria ser padronizado |
| 30 | Header/topbar — logo/marca | 🏆 Bolão do Ferrari · Copa 2026 | 🇧🇷 Bolão do Ferrari · Brasileirão 2026 | 🏅 Bolão do Ferrari · Copa do Brasil 2026 | Sim (mesmo padrão visual, emoji distinto) | CONSISTENT | Nenhuma — padrão intencional e consistente | — | — |
| 31 | Seletor de bolão (dropdown) | `#bolaoSelect` com as 3 opções | idêntico | idêntico | Sim | CONSISTENT | Nenhuma | — | — |
| 32 | Seletor de idioma (lang-links) | 3 idiomas ativos (pt-BR/es/en-US clicáveis) | Apenas pt-BR ativo; ES/EN com `disabled` (desde v1.12) | Apenas pt-BR ativo; ES/EN com `disabled` (desde v1.5) | Intencionalmente diferente (documentado nos commits recentes) | INTENTIONALLY_DIFFERENT | — | — | Reavaliar quando ES/EN forem traduzidos para os dois apps novos |
| 33 | Traduções — cobertura de chaves | 3 idiomas completos (~735 chaves totais) | apenas pt-BR (~145 chaves) | apenas pt-BR (~101 chaves) | Consequência do item 32 | INTENTIONALLY_DIFFERENT | — | — | — |
| 34 | Suporte via WhatsApp (botão + QR) | `#supportWhatsappBtn` no header + QR em `assets/whatsapp-group-qr.png` | Presente desde v1.14 (`#supportWhatsappBtn`, mesmo grupo/ícone da Copa) | Presente desde v2.0 (idem) | Recomendado para paridade de suporte ao participante | CONSISTENT | Resolvido nos três apps — mesmo grupo real reaproveitado, não são grupos novos | — | — |
| 35 | Pasta `assets/` (logos, QR codes) | Presente (`whatsapp.svg`, `zelle-qr.png`, `cashapp.svg`, etc.) | Presente desde v1.14 (`whatsapp.svg`, `whatsapp-group-qr.png`, `zelle-qr.png`, copiados da Copa) | Presente desde v2.0 (idem) | Consequência dos itens 34 e 36 | CONSISTENT | Resolvido — mesmos arquivos reais copiados da Copa, não recriados do zero | — | — |
| 36 | Pagamento — QR code Zelle | Exibido (`CONFIG.zelle.qrImage`) | Não configurado (`zelle.qrImage` ausente) — pagamento só em texto | Exibido desde v2.0 (`CONFIG.zelle.qrImage`, asset copiado da Copa) | Recomendado | NEEDS_REVIEW | CDB2026 resolvido; BR2026 ainda sem QR (asset já existe em `bolao/br2026/assets/zelle-qr.png` desde esta sessão, só falta configurar `zelle.qrImage` e renderizar) | Medium | Portar para BR2026 |
| 37 | Pagamento — métodos (CashApp/Zelle/Venmo) | 3 métodos, mesmos handles | idênticos | idênticos | Sim | CONSISTENT | Nenhuma | — | — |
| 38 | Botões primary (`button`) | `border-radius:12px; padding:11px 18px; background:var(--green)` | idêntico | idêntico | Sim | CONSISTENT | Nenhuma — CSS byte-a-byte equivalente | — | — |
| 39 | Botões secondary | `background:var(--bg3); border:1px solid var(--border2)` | idêntico | idêntico | Sim | CONSISTENT | Nenhuma | — | — |
| 40 | Botões danger | `background:var(--danger-bg); color:var(--danger-tx)` | idêntico (classe existe no CSS mas não é usada em nenhum botão da UI) | idêntico (idem) | Sim | CONSISTENT | Classe CSS consistente; uso na UI é que diverge (ver item 7) | Low | — |
| 41 | Botões small (`small-btn`) | `padding:7px 11px; font-size:12px; border-radius:9px` | idêntico | idêntico | Sim | CONSISTENT | Nenhuma | — | — |
| 42 | Estado `disabled` de botão | `opacity:.45; cursor:not-allowed` | idêntico | idêntico | Sim | CONSISTENT | Nenhuma | — | — |
| 43 | Cards (`.card`) | `border-radius:18px; padding:18px; box-shadow:0 8px 32px rgba(0,0,0,.22)` | idêntico | idêntico | Sim | CONSISTENT | Nenhuma | — | — |
| 44 | Badges de status de jogo | `.status-chip` (`done`/`pending`/`live`, com animação de pulso para live) | `.game-status.postponed` apenas — sem chip para "ao vivo"/"finalizado" | **Nenhum badge de status de jogo** | Sim, mínimo para a seção Jogos | NEEDS_REVIEW | BR2026 tem cobertura parcial; CDB2026 não tem nenhuma | Medium | Portar `.status-chip` (done/pending/live) para os dois apps |
| 45 | Badges de zona (G4/Z4) | N/A (não se aplica à Copa) | `.zone-badge`, `.g4-badge`, `.z4-badge` | N/A (não se aplica à Copa do Brasil) | Tournament-specific | INTENTIONALLY_DIFFERENT | — | — | — |
| 46 | Inputs (nome, e-mail, pagamento) | Estrutura idêntica de `<label>` + `<input>`/`<select>` | idêntica | idêntica | Sim | CONSISTENT | Nenhuma | — | — |
| 47 | Validação de e-mail | Regex `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` (documentada em REQUIREMENTS.md) | mesmo padrão de regex no código | mesmo padrão de regex no código | Sim | CONSISTENT | Nenhuma | — | — |
| 48 | Escaping de HTML (XSS) | Função `escapeHtml()` | Função `esc()` — logicamente equivalente | Função `esc()` — logicamente equivalente | Sim (comportamento) | CONSISTENT | Apenas nome de função difere entre Copa e os dois novos apps | Low | Nenhuma ação funcional; considerar padronizar o nome em uma futura reescrita |
| 49 | `document.write` | Não usado (Blob URL) | Não usado | Não usado | Sim | CONSISTENT | Nenhuma | — | — |
| 50 | `fetch()` com timeout/abort | `AbortController` usado em 5 dos 9 fetches | **Nenhum** `AbortController` em nenhum dos 6 fetches | **Nenhum** `AbortController` em nenhum dos 3 fetches | Recomendado para chamadas a ESPN/Supabase | NEEDS_REVIEW | Requisições de rede em BR2026/CDB2026 podem travar indefinidamente sem timeout | Medium | Adicionar `AbortController` com timeout nas chamadas ESPN/Supabase, seguindo o padrão da Copa |
| 51 | Blocos `catch` vazios | 2 ocorrências (fallback silencioso documentado) | 1 ocorrência | 1 ocorrência | Aceitável se documentado | CONSISTENT | Padrão de fallback silencioso presente nos três, proporcional ao tamanho do app | Low | — |
| 52 | `console.log` / `TODO` / `FIXME` residual | 1 comentário `TODO` (proxy de produção, documentado em SECURITY.md) | Nenhum | Nenhum | — | CONSISTENT | Nenhum `console.log` em nenhum dos três apps | — | — |
| 53 | IDs HTML duplicados | Nenhum encontrado | Nenhum encontrado | Nenhum encontrado | Sim | CONSISTENT | Nenhuma | — | — |
| 54 | CSP (Content-Security-Policy) | Escopo amplo (ESPN, API-Football, Polymarket, ipify) | Escopo médio (ESPN + espncdn para imagens) | Escopo mínimo (só Supabase/EmailJS) | Cada CSP deve refletir só o que o app usa | CONSISTENT | Divergência é esperada e correta — cada CSP é mínimo para as chamadas reais daquele app | — | — |
| 55 | Scripts externos (CDN + SRI) | emailjs@4 + supabase-js@2.45.4, mesmos hashes `integrity` | idêntico | idêntico | Sim | CONSISTENT | Nenhuma | — | — |
| 56 | Analytics/telemetria de terceiros | Nenhum | Nenhum | Nenhum | Sim | CONSISTENT | Nenhuma — nenhum dos três apps tem analytics | — | — |
| 57 | Breakpoints responsivos principais | 900px / 501-900 / 500px / 480px | mesmos breakpoints principais + breakpoints extras para grids de palpites | mesmos breakpoints principais | Sim (núcleo) | CONSISTENT | Núcleo idêntico; breakpoints extras são tournament-specific (grids de G4/Z4) | — | — |
| 58 | Acessibilidade — skip link, aria-live, aria-label | Presentes | Presentes | Presentes | Sim | CONSISTENT | Nenhuma | — | — |
| 59 | Versionamento de cache-busting (`?v=`) | `2aaedfb` | `2aaedfb` | `2aaedfb` | Sim | CONSISTENT | Os três referenciam o mesmo hash de commit — sincronizados pelo bot `sync_version.yml` | — | — |
| 60 | `robots` meta tag | `noindex,nofollow` | idêntico | idêntico | Sim | CONSISTENT | Nenhuma | — | — |
| 61 | Símbolo do time (junto ao nome) | Bandeira do país (`DATA.flags`, emoji) — correto para seleções nacionais | Escudo real da ESPN (`_teamLogos`, fetch ao vivo do standings), classes `.team-logo` (14px) / `.match-logo` (22px) | Escudo real da ESPN, mesmas URLs/IDs verificados manualmente e mesmas classes CSS que o BR2026 (`DATA.teamLogos` fixo em `data.js`, sem fetch ao vivo — CDB2026 não tem API própria) | Bandeira só faz sentido pra seleção; clubes devem usar escudo real — Copa é INTENTIONALLY_DIFFERENT por natureza do torneio, BR2026/CDB2026 devem bater entre si | CONSISTENT (BR2026 ↔ CDB2026); INTENTIONALLY_DIFFERENT (Copa, tournament-specific) | Resolvido em v1.15/v2.1 depois de um round de bugs reais: escudo do BR2026 renderizava gigante (`<img>` sem `width`/`height`, `.team-logo` sem dimensão no CSS) e o CDB2026 tinha uma bolinha colorida com iniciais em vez de escudo real — ver LESSONS_LEARNED.md | — | Nenhuma — ambos os apps de clube agora usam o mesmo padrão de escudo real |
| 62 | Tokens de cor `--gold`/`--red` no `:root` | `--gold:#f59e0b`, `--red:#ff6b6b` | `--gold:#f59e0b`, `--red:#ff6b6b` | `--gold:#f59e0b`, `--red:#ff6b6b` | Sim, todo app deveria ter os mesmos tokens de cor semântica | CONSISTENT | **Resolvido (PR120-final review item 5a, 2026-08-03)** — `--red` já está unificado em `#ff6b6b` nos três apps (verificado por grep direto de `bolao/{copa2026,br2026,cdb2026}/css/styles.css`); a divergência `#f87171` registrada anteriormente nesta linha não reflete mais o código atual — corrigida em uma rodada anterior deste mesmo ciclo de padronização e não atualizada aqui até agora. `status-badge:color` na auditoria automatizada (`audit_visual_consistency.mjs`) já reporta `EQUAL`, não `JUSTIFIED`/`DIVERGENT` — a antiga entrada de ALLOWLIST.json para esse par foi removida por não suprimir mais nenhum achado real | — | — |
| 63 | Input/select/label (fundo, `border-radius`, foco, case do label) | `var(--bg3)`/`9px`/`border-color` no foco/label UPPERCASE `var(--muted)` desde v4.126 (migrado do padrão BR2026/CDB2026) | `var(--bg3)`/`9px`/`border-color`/UPPERCASE (padrão original) | idêntico ao BR2026 | Sim | CONSISTENT | Resolvido em v4.126 — Copa migrada para o padrão que os outros dois já usavam | — | — |
| 64 | `h1,h2,h3` — normalização global de heading | `margin:.15em 0 .4em`, `h2:1.25rem`, `h3:1.05rem` (já existia) | Adicionado em v1.16 (idêntico à Copa) | Adicionado em v2.2 (idêntico à Copa) | Sim | CONSISTENT | Resolvido — antes só a Copa normalizava, um `<h3>` fora de `.section-head` renderizava no tamanho default do navegador em BR2026/CDB2026 | — | — |
| 65 | `.rules-table td` padding | `7px 10px` desde v4.126 (era `8px 10px`) | `7px 10px` (já era) | `7px 10px` (já era) | Sim | CONSISTENT | Resolvido — Copa alinhada aos outros dois | — | — |
| 66 | Botão sticky (`.sticky-submit button`) — sombra e `min-width` | `min-width:200px` adicionado em v4.126; sombra já era verde `rgba(47,229,110,.35)` | Sombra trocada para verde em v1.16 (era `rgba(0,0,0,.5)`); `min-width:200px` já existia | Sombra trocada para verde em v2.2 (era `rgba(0,0,0,.5)`); `min-width:200px` já existia | Sim | CONSISTENT | Resolvido nos três — mesma sombra verde e mesmo `min-width` | — | — |
| 67 | Badge/status indicator (jogo ao vivo/finalizado, pagamento) | `.status-chip` — pílula, agora tokenizada (`var(--green)`/`var(--red)`, era hex literal) | `.game-status` — agora pílula (era texto puro); `.paid-badge` — `border-radius:999px`/`padding:4px 10px`/`weight:900` | `.paid-badge` — mesmo tratamento; sem chip de status de jogo (sem API ao vivo, gap distinto) | Sim — mesmo conceito semântico | CONSISTENT | Resolvido em v4.127/v1.17/v2.3 — mesma paleta/formato de pílula nos três; nomes de classe mantidos por app (custo de renomear no JS > benefício), só a CSS convergiu | — | CDB2026 sem chip de jogo ao vivo continua como gap de feature (não de componente), ver item 24 |
| 68 | Estrutura do card de Ranking | `.rank-row` — grid denso de 1 linha, detalhe expansível por clique | `.rank-row`/`.picks-detail` — adotado em v1.17, mesmo padrão da Copa (`_openRankDetails`, toggle) | `.rank-row`/`.picks-detail` — adotado em v2.3, idêntico | Sim — é a tela mais visitada pós-cutoff nos três apps | CONSISTENT | Resolvido — BR2026/CDB2026 reescreveram `renderRanking()` para gerar `.rank-row` + `.picks-detail` como elementos irmãos, igual à Copa; `renderPickDisplay()` (conteúdo do detalhe) não mudou, só passou a ficar escondido por padrão | — | Badge de pagamento (ausente na Copa) inserido dentro da célula de nome, não como 5ª coluna — mantém o grid de 4 colunas da Copa intacto |
| 69 | Sistema de toast não-bloqueante | `.bolao-toast`/`showToast()` — original | Portado em v1.17 (mesma implementação, copiada de `bolao/js/app.js`) | Portado em v2.3 (idem) | Recomendado | CONSISTENT | Resolvido — `alert()` convertido para toast em confirmações/erros que não são validação de formulário (essas continuam `alert()`, igual à Copa); CDB2026 também aproveitou pra parar de duplicar o código do comprovante no alert, já que `renderReceiptBox()` mostra persistente | — | — |
| 70 | `main` max-width | `1140px` | `1140px` desde v1.18 (era `860px`) | `1140px` desde v2.4 (era `860px`) | Sim — Copa é a referência canônica (regra em `CLAUDE.md`) | CONSISTENT | Resolvido — todos os grids internos usam `fr`/`auto-fill`, nenhum overflow introduzido | — | — |
| 71 | Card de jogo (lista pública) | `.game-card` — card completo (`background`/`border`/`radius:16px`) | `.game-card` — card completo desde v1.19 (era lista plana só com `border-bottom`) | `.confronto-card card` — já usava a classe `.card` compartilhada, nenhuma mudança necessária | Sim | CONSISTENT | Resolvido no BR2026 | — | — |
| 72 | Grid de time×placar×time no card de jogo | `.game-teams { grid: 1fr auto 1fr }` — centro sempre alinhado | `.game-matchup` migrado pra grid `1fr auto 1fr` em v1.19 (era `flex justify-content:center`, centro desalinhava com nomes de tamanhos diferentes) | `.confronto-header`/`.leg` já usam layout próprio adequado ao formato ida+volta (tournament-specific) | Sim para BR2026 (mesmo formato de partida única da Copa); CDB2026 tem formato de confronto ida+volta, estrutura interna é diferente por natureza dos dados | CONSISTENT (Copa↔BR2026); INTENTIONALLY_DIFFERENT (CDB2026, ida+volta) | Resolvido no BR2026 | — | — |
| 73 | Card de pagamento — ícone por método | `.pay-card` com `.pay-icon`/`payIcon()` (SVG por método) | Adicionado em v1.19 (não tinha ícone nenhum) | Adicionado em v2.5 (idem) | Sim | CONSISTENT | Resolvido — `cashapp.svg`/`venmo.svg` copiados dos assets reais da Copa para os dois apps, `zelle-qr.png` já existia | — | — |
| 74 | `.pay-grid` — nº de colunas | `repeat(3, 1fr)` fixo | `repeat(3,1fr)` desde v1.19 (era `auto-fill, minmax(200px,1fr)`) | `repeat(3,1fr)` desde v2.5 (idem) | Sim — os três apps têm exatamente 3 métodos de pagamento | CONSISTENT | Resolvido | — | — |
| 75 | Texto do botão WhatsApp | "Suporte WhatsApp" | "Suporte WhatsApp" desde v1.19 (era só "WhatsApp") | "Suporte WhatsApp" desde v2.5 (idem) | Sim | CONSISTENT | Resolvido | — | — |
| 76 | `input[type=number]` — spinner nativo | Suprimido (`-webkit-appearance:none` nos spin-buttons) desde v4.128 | Suprimido desde v1.19 | Suprimido desde v2.5 | Sim | CONSISTENT | Resolvido nos três ao mesmo tempo | — | — |
| 77 | `.admin-toolbar` — gap/margin | `gap:8px; margin-bottom:14px` | Alinhado (era `6px`/`8px`) | Alinhado (era `6px`/`8px`) | Sim | CONSISTENT | Resolvido — diferença de 2px/6px, baixo impacto visual mas corrigido para exatidão | — | — |
| 78 | `.admin-row` — lista vs. card | `<div class="card admin-entry">` — cada linha é um card completo (variante `admin-entry-full`) | `.admin-row` — lista densa com `border-bottom`, não é card (variante `admin-entry-dense`) | `.admin-row` — idem BR2026 (`admin-entry-dense`) | Recomendado pela regra de referência canônica, mas admin tem densidade de dados maior (lista de entradas pode ser longa) e é área de baixa visibilidade (só o Eduardo usa) | INTENTIONALLY_DIFFERENT | **Formalizado (PR120-final review item 5b, 2026-08-03)** — deixou de ser uma divergência não resolvida: os dois layouts agora são variantes documentadas do mesmo componente, ver `docs/bolao/DESIGN_SYSTEM.md` § "Admin entry row — full vs. dense variant" pelo critério de quando usar cada um. `ALLOWLIST.json` (`bolao/scripts/audit_visual_consistency.mjs`) tem entradas correspondentes para `admin-card-row` (`height`, `fontSize`, `lineHeight`, `padding`, `margin`, `gap`, `borderRadius`, `backgroundColor`) referenciando esta seção | — | — |
| 79 | Tabela do Brasileirão — colunas (BR2026 apenas) | N/A — Copa não tem tabela de classificação (torneio é mata-mata) | V/E/D/GP/GC/SG adicionados em v1.19 (só tinha Pos/Time/Pts) | N/A — CDB2026 não tem standings (sem API ao vivo) | Tournament-specific — não existe equivalente na Copa pra comparar | INTENTIONALLY_DIFFERENT | Resolvido como bug funcional (dado já vinha da ESPN, só não era exibido), não como divergência cross-app | — | — |

## Resumo por severidade

| Severidade | Quantidade |
|---|---|
| Critical | 0 |
| High | 3 (itens 1, 8/9/10 combinados) |
| Medium | 10 |
| Low | 14 (itens 62 e 78 resolvidos em PR120-final review item 5) |
| Sem severidade (CONSISTENT/INTENTIONALLY_DIFFERENT sem ação) | 52 |

## Resumo por status

| Status | Quantidade |
|---|---|
| CONSISTENT | 49 |
| INTENTIONALLY_DIFFERENT | 15 |
| MISSING | 0 |
| OUTDATED | 0 |
| NEEDS_REVIEW | 13 |
| CRITICAL_DIVERGENCE | 0 |

### Progresso — Copa como referência visual canônica (v4.128 / v1.19 / v2.5)

Itens resolvidos: 70 (`main` max-width), 71 (card de jogo no BR2026), 72 (grid time×placar no
BR2026), 73 (ícone no card de pagamento), 74 (`.pay-grid` 3 colunas), 75 (texto do botão
WhatsApp), 76 (spinner de input numérico), 77 (`.admin-toolbar` gap/margin). Item 78
(`.admin-row` vs. card por linha) ficou registrado como `NEEDS_REVIEW` nesta rodada — **ver
"Progresso — PR120-final review item 5 (2026-08-03)" abaixo para a formalização posterior**.
Item 79 é uma correção funcional da tabela do Brasileirão (dado que a ESPN já fornecia e não
estava sendo exibido), não uma divergência cross-app, classificado `INTENTIONALLY_DIFFERENT`
porque a Copa não tem equivalente (mata-mata não tem tabela de classificação).

### Progresso — PR120-final review item 5 (2026-08-03)

Os dois itens deixados em aberto nas rodadas anteriores foram fechados nesta:

- **Item 62** (`--red` divergente entre Copa e BR2026/CDB2026): já estava resolvido no código —
  os três apps têm `--red:#ff6b6b` idêntico (reverificado por grep direto do CSS). A linha da
  matriz estava desatualizada (ainda citava `#f87171` para BR2026/CDB2026), não o código. Movido
  de `NEEDS_REVIEW`/Low para `CONSISTENT`/sem severidade. A entrada de `ALLOWLIST.json` para
  `status-badge:color` — que existia só para justificar essa divergência já inexistente — foi
  removida por não suprimir mais nenhum achado real (a auditoria automatizada já reportava
  `EQUAL`, tornando a entrada morta).
- **Item 78** (`.admin-row` denso vs. `.admin-entry` card completo): formalizado como dois
  variantes documentados do mesmo componente (`admin-entry-full`/`admin-entry-dense`) em
  `docs/bolao/DESIGN_SYSTEM.md` § "Admin entry row — full vs. dense variant", com critério
  explícito de quando usar cada um. Movido de `NEEDS_REVIEW`/Low para `INTENTIONALLY_DIFFERENT`
  — deixa de ser uma divergência pendente e passa a ser uma decisão de design registrada.

Junto com bugs reais encontrados testando o CDB2026 ao vivo (não fazem parte da comparação com
a Copa, mas foram corrigidos na mesma leva): ordem de mandante/visitante no jogo de volta,
escudo faltando nas linhas de jogo individuais, card de edição de entrada não escondendo por
completo, layout do palpite por confronto reorganizado numa linha, e a automação da regra real
da CBF pra "quem avança" (trava em vitória simples, destrava em empate agregado).

### Progresso — patches mínimos do DESIGN_SYSTEM.md (v4.126 / v1.16 / v2.2)

Itens resolvidos nos três apps: 63 (input/select/label), 64 (h1/h2/h3), 65 (padding de
`.rules-table`), 66 (sombra/`min-width` do botão sticky). Item 62 (tokens `--gold`/`--red`)
ficou parcialmente resolvido nesta rodada específica — tokens existiam nos três, mas o valor de
`--red` ainda não estava confirmado unificado. **Totalmente resolvido em PR120-final review item
5 (2026-08-03) — ver "Progresso — PR120-final review item 5" abaixo: `--red:#ff6b6b` já é
idêntico nos três apps.**

### Progresso — findings Critical/High autorizados (v4.127 / v1.17 / v2.3)

Autorização explícita do Eduardo para os 3 findings maiores. Todos resolvidos:

- **67 (badge/status)**: CSS convergiu (paleta, `border-radius:999px`, `padding:4px 10px`,
  `font-weight:900`) nos três apps; nomes de classe (`.status-chip` vs `.game-status`/
  `.paid-badge`) mantidos por app para não arriscar o JS de cada um.
- **68 (estrutura do Ranking)**: BR2026 e CDB2026 reescreveram `renderRanking()` para adotar o
  `.rank-row`/`.picks-detail` da Copa (grid denso de 1 linha + detalhe expansível por clique).
  Copa não precisou mudar — já era a referência.
- **69 (toast)**: `showToast()`/`.bolao-toast` portados para BR2026/CDB2026, substituindo
  `alert()` em confirmações/erros (validação de formulário continua `alert()`, igual à Copa).

Nenhuma fórmula de scoring, critério de desempate, ou regra de negócio foi tocada nesta rodada
— `audit_scoring.py` 5/5 em cada versão intermediária. Zero itens `CRITICAL_DIVERGENCE`
restantes na matrix pela primeira vez desde o início da auditoria de plataforma.

### Progresso — sessão anterior (governança de plataforma + CDB2026 v2.0/BR2026 v1.14)

Itens resolvidos no CDB2026 (v2.0) e/ou BR2026 (v1.14): 7 (parcial), 8/9/10 (parcial), 14
(parcial), 16 (parcial), 34 (total), 35 (total), 36 (parcial). Pendência de maior risco ainda
aberta: item 1 (sem `audit_scoring.py` equivalente para BR2026/CDB2026, apesar de o CDB2026 ter
ganhado uma fórmula de scoring nova e mais complexa — ver `bolao/cdb2026/CHANGELOG.md` v2.0).
<!-- AUTO:CONSISTENCY_MATRIX:END -->

## Nota manual — aba "Probabilidades" no CDB2026 (2026-07-13, v2.8)

Não catalogado como linha própria na última auditoria formal (a matrix acima não tinha um item
dedicado a "presença da aba Probabilidades"). Registro manual até a próxima auditoria formal
reprocessar a tabela inteira:

- **Antes:** CDB2026 tinha nav com 7 botões (sem "Probabilidades"), Brasileirão com 9
  (incluindo "Tabela", que não se aplica ao CDB2026 — mata-mata sem classificação por pontos
  e sem API ao vivo, `INTENTIONALLY_DIFFERENT` legítimo).
- **Depois:** CDB2026 ganhou a aba (nav agora com 8 botões). Diferença de torneio preservada
  de propósito: a matemática não é uma cópia da Copa/Brasileirão — é nova, adaptada para
  confronto ida+volta com placar agregado (convolução de duas pernas + regra CBF sem gol fora
  de casa, pênaltis tratados como 50/50).
- **Risco/dívida técnica registrado:** os valores em `bolao/cdb2026/js/data.js` → `strength`
  são uma estimativa inicial de força relativa entre os 16 clubes, não uma fonte oficial —
  **pendente de revisão do Eduardo antes de publicar o app.** Não afeta scoring/resultado
  real (`audit_scoring.py` continua 5/5, campo não é lido por nenhum caminho de pontuação).

## Nota manual — CDB2026 reformulado do zero (2026-07-13, v3.0)

**Supersede parcialmente a nota acima e várias linhas da matrix AUTO relacionadas ao CDB2026**
(itens que descrevem o bracket fixo de 16 times/15 confrontos — esse modelo não existe mais).
Não editado dentro do bloco `AUTO:CONSISTENCY_MATRIX` (é substituído por inteiro na próxima
auditoria formal); registrado aqui como nota manual até lá.

- **Motivo:** Eduardo identificou, com o Regulamento Específico da Copa do Brasil 2026 em mãos,
  que o CDB2026 (v2.9) modelava a competição errado — bracket fixo copiado da Copa do Mundo em
  vez das 9 fases reais (126 clubes, sorteio progressivo, formato misto partida única/ida e
  volta por fase). Ver auditoria completa e modelo aprovado em
  `docs/bolao/CDB2026_RULES_AND_MODEL.md` (fonte oficial do modelo do CDB2026 a partir de
  agora) e `docs/bolao/PROJECT_MEMORY.md` → "Auditoria de modelo de negócio".
- **O que mudou estruturalmente:** confrontos/partidas saíram de `data.js` (estático, bracket
  fixo) para o estado dinâmico `s.phases[faseId].ties` (cadastrado pelo admin fase a fase,
  conforme cada sorteio real). Palpite deixou de ser um "agregado" digitado direto e passou a
  ser por partida, com agregado sempre calculado. Cutoff deixou de ser um valor único global e
  passou a ser por fase. Pontuação de bônus por confronto (5 pts "acertar quem se classifica")
  ficou separada da pontuação de partida — antes eram a mesma coisa.
- **`INTENTIONALLY_DIFFERENT` confirmado, não generalizar:** o modelo de fases dinâmicas com
  sorteio progressivo é específico da Copa do Brasil (regulamento real) — Copa do Mundo e
  Brasileirão têm formatos de torneio conhecidos com antecedência e **não devem** adotar esse
  padrão. Ver `PLATFORM_GOVERNANCE.md`: diferenças de torneio devem ser preservadas.
- **Itens da matriz AUTO que ficam desatualizados até a próxima auditoria formal**: qualquer
  item que descreva "bracket" ou "confrontos" do CDB2026 como algo fixo/definido em `data.js`
  (o dado agora é dinâmico, cadastrado via admin) — a comparação de admin toolbar (item 6) e
  comprovante (item 8) continuam válidas conceitualmente, só a estrutura de dados por trás do
  torneio em si mudou.
- **Não afeta Copa nem Brasileirão** — mudança isolada ao modelo de dados do CDB2026, nenhum
  arquivo de `bolao/` ou `bolao/br2026/` foi tocado.

## Nota manual — classificação ao vivo + movimento de ranking no BR2026 (2026-07-13, v1.23)

Auditoria completa e detalhes técnicos em `docs/bolao/BR2026_LIVE_STANDINGS.md`. Resumo para a
matrix:

| Item | Copa | BR2026 | CDB2026 | Status | Correção necessária |
|---|---|---|---|---|---|
| Seta de movimento do ranking de participantes | Duas implementações concorrentes: `computeRankArrows()`/`_rankArrowState` (sessão, baseline = último render — **imperfeita**) e `liveMatchPointsTable()` (stateless, oficial-vs-provisório — **correta**, mas só usada dentro do detalhe de uma partida, não no ranking geral) | Nova: `calculateRankingMovement()`, stateless, baseline = janela de partidas ao vivo, reusa `rankEntries()` (mesmo comparador do ranking exibido) | Não existe ainda | `NEEDS_REVIEW` (Copa) / `CONSISTENT` (BR2026, novo, correto) | Copa: considerar migrar `renderRanking()` geral para o padrão `liveMatchPointsTable()` — **fora do escopo desta mudança**, registrado como dívida técnica, não corrigido. CDB2026: adicionar quando fizer sentido (torneio de eliminação simples, sem "rodadas" no mesmo sentido) |
| Classificação de clube ao vivo (tabela) | Não aplicável (Copa não tem tabela de liga) | Nova: `calculateLiveStandings()`, tabela reordena por posição ao vivo durante uma janela de partidas, coluna "Mov." com setas acessíveis | Não aplicável (mata-mata, sem tabela) | `CONSISTENT` (Copa/CDB2026 não têm esse conceito por design do torneio — `INTENTIONALLY_DIFFERENT`) | Nenhuma — BR2026 é o único app com liga por pontos |
| Classes CSS de movimento | `.rank-arrow`, `.rank-arrow-n` (Copa, mantidas como estão) | Novas: `.movement`, `.movement-up/-down/-same/-unavailable`, `.movement-n` — nomenclatura diferente de propósito (ver BR2026_LIVE_STANDINGS.md) | N/A ainda | `INTENTIONALLY_DIFFERENT` | Copa mantém seu naming atual; não renomear por conveniência agora — só se/quando o padrão `.rank-arrow` da Copa for migrado para o padrão stateless |
| Aria-label / acessibilidade das setas | `title` apenas, sem `aria-label`/texto oculto | `title` + `<span class="visually-hidden">` com texto completo em ambos os movimentos (clube e participante) | N/A | `NEEDS_REVIEW` (Copa) / `CONSISTENT` (BR2026) | Copa: adicionar texto acessível às setas existentes — fora do escopo desta mudança |
| Identificação de partida ao vivo (matching) | Usa IDs internos do bracket (`data.js`), não depende de nome de time da API | Antes: só nome de time da API ESPN. Agora: `ev.id` estável como critério primário, nome como fallback | N/A (sem API ao vivo) | `CONSISTENT` (corrigido nesta mudança) | — |
| Flag `postponed`/cancelado excluindo jogo do cálculo | N/A (não usa API externa para resultados) | Antes: campo já computado em `fetchSchedule()`, mas não lido em nenhum lugar. Agora: checado dentro de `calculateLiveStandings()` | N/A | `CONSISTENT` (corrigido nesta mudança) | — |

**Não generalizar**: o padrão de movimento de clube é `TOURNAMENT_SPECIFIC` do BR2026 (única
liga por pontos entre os três apps). O padrão de movimento de participante é conceitualmente
`PLATFORM_SHARED`, mas a Copa **não foi migrada** para a implementação correta nesta mudança —
ficou registrado como dívida técnica pré-existente, não como regressão desta entrega.

## Nota manual — sincronização com ESPN no admin do CDB2026 (2026-07-13, v3.1)

| Item | Copa | BR2026 | CDB2026 | Status | Correção necessária |
|---|---|---|---|---|---|
| Botão admin de sincronização com ESPN, humano confirma antes de gravar | `espnFillResultsBtn` — pré-preenche o resultado final, admin ainda clica "Salvar resultados" | `espnFillResultsBtn` — mesmo padrão | Novo: "Buscar da ESPN" — lista candidatos, admin escolhe fase e confirma confronto por confronto | `CONSISTENT` (mesmo princípio: busca sob demanda + confirmação humana, nunca escrita silenciosa) | Nenhuma — CDB2026 precisa de mais confirmação por linha (cria confrontos, não só resultados de um bracket já fixo), então a UI é mais granular de propósito, não inconsistente |
| CSP `connect-src` inclui `site.api.espn.com` | Sim | Sim | **Não tinha** — bug pré-existente, encontrado e corrigido nesta mudança | `CONSISTENT` (corrigido) | — |

Não generalizado como polling automático: CDB2026 é mata-mata sem "ao vivo" contínuo, então a
sincronização é sob demanda (clique do admin), diferente do polling em segundo plano do BR2026 —
diferença intencional, documentada em `docs/bolao/CDB2026_RULES_AND_MODEL.md` seção 7, não uma
divergência a corrigir.

## Nota manual — Supabase habilitado em BR2026 e CDB2026 (2026-07-13)

**Supersede o item 21 do bloco AUTO acima** (não editado ali — será substituído por inteiro na
próxima auditoria formal, ver convenção no topo deste arquivo):

- **Antes:** `database.enabled` — Copa `true`, BR2026/CDB2026 `false` ("aguardando criação da
  linha"), classificado `INTENTIONALLY_DIFFERENT`.
- **Depois:** os três `true`. Eduardo pediu explicitamente para não deixar dados só em
  `localStorage`. `localFallback: true` mantido nos três — arquitetura local-first com espelho
  remoto preservada, não removida (ver decisão registrada em `PROJECT_MEMORY.md`).
- **Pendência que impedia isso de funcionar de fato**: as policies de RLS do Supabase só
  liberavam `id='main'`. SQL para estender aos três ids entregue em
  `docs/bolao/DATABASE_SETUP_SUPABASE.md` "Múltiplos apps na mesma tabela" — **rodado por
  Eduardo em 2026-07-13**. `CONSISTENT` no código e, a partir de agora, também
  operacionalmente — os três apps devem estar sincronizando de verdade. Confirmação prática
  ainda recomendada: criar uma entrada em cada app e checar em duas abas/dispositivos.

**Também supersede parcialmente o item 54** (CSP): CDB2026 ganhou `site.api.espn.com` em
`connect-src` (v3.1, ver nota acima) — escopo deixou de ser "só Supabase/EmailJS", passou a
incluir ESPN como BR2026. Ainda `CONSISTENT` (cada CSP reflete o que o app realmente chama), só
o texto descritivo do item 54 ficou desatualizado até a próxima auditoria formal reprocessar a
tabela.

## Nota manual — sincronização com ESPN do CDB2026 ficou mais automática que a da Copa/BR2026 (2026-07-13, v3.3)

**Supersede a linha da nota "sincronização com ESPN" acima** (marcada v3.1) — Eduardo testou o
fluxo de confirmação por confronto e pediu para automatizar. Comparação atualizada:

| Item | Copa | BR2026 | CDB2026 | Status | Correção necessária |
|---|---|---|---|---|---|
| Grau de automação da sincronização com ESPN | `espnFillResultsBtn` — busca sob demanda, pré-preenche, admin ainda confirma manualmente ("Salvar resultados") | idem | **Mais automático**: admin escolhe a fase ativa uma vez; confrontos novos são adicionados sozinhos daí em diante (sem clique por confronto); só travar um resultado continua manual | `INTENTIONALLY_DIFFERENT` | Nenhuma — CDB2026 tem muito mais confrontos a cadastrar ao longo do torneio (um por fase, repetidamente) do que a Copa/BR2026 (uma tabela final, uma vez). Automatizar a criação de confrontos aqui não é o mesmo risco que automatizar um resultado — a trava de resultado (o que decide pagamento) continua manual nos três apps |

Não generalizar para Copa/BR2026: os dois têm um resultado final a lançar (uma vez, um evento),
não uma sequência de confrontos a cadastrar repetidamente ao longo de meses — o caso de uso que
motivou automatizar a criação de confrontos no CDB2026 não existe neles.

## Nota manual — item 23 resolvido: listener de bfcache (`pageshow`) propagado para BR2026/CDB2026 (2026-07-13, BR2026 v1.26 / CDB2026 v3.4)

**Resolve o item 23 do bloco AUTO** ("BR2026/CDB2026 hoje só têm `visibilitychange`, sem `focus`
nem `pageshow`" — classificado `NEEDS_REVIEW`, catalogado em `LESSONS_LEARNED.md` "Multi-tab").

- **Antes:** só a Copa tinha o listener de `pageshow`/`event.persisted` (desde v4.111, corrigindo
  um bug real de bfcache do WebKit no iOS Safari — a página ficava presa em estado de memória
  antigo ao voltar de segundo plano). BR2026/CDB2026 tinham só `visibilitychange`, sem cobertura
  para esse caso específico.
- **Depois:** os três apps têm `debouncedReload()` cobrindo visibilitychange + focus + pageshow,
  mesmo padrão. Motivado por Eduardo pedindo para garantir que nada fique desatualizado/em cache
  agora que BR2026/CDB2026 têm Supabase ligado — a causa raiz real do bug histórico que ele
  citou ("mesmo problema da Copa antiga") era a regra de merge (já corrigida nos três apps,
  `preferRemoteResults: true`) combinada com esse gatilho de resync não confiável em bfcache —
  não a existência do `localStorage` em si. Detalhe completo em `LESSONS_LEARNED.md`
  "Supabase — merge/sync" e "Safari".
- `CONSISTENT` nos três apps agora.

## Nota manual — ordem dos botões de header/nav divergindo da Copa (2026-07-14, BR2026 v1.27 / CDB2026 v3.5)

Eduardo apontou que "a ordem dos botões não é a mesma em todos". Auditado contra a Copa
(referência canônica), dois desalinhamentos reais no `index.html` de BR2026 e CDB2026 (ambos
tinham o mesmo problema):

| Item | Copa | BR2026 (antes) | CDB2026 (antes) | Status | Correção |
|---|---|---|---|---|---|
| Ordem WhatsApp vs. idioma no header | WhatsApp → PT-BR/ES-MX/EN-US → seletor de bolão | idioma → WhatsApp (trocados) | idioma → WhatsApp (trocados) | `CONSISTENT` (corrigido) | Reordenado para bater com a Copa nos dois apps |
| Posição de Participantes/Pagamento no nav | Logo após Ranking (posições 3–4; ocultos por CSS na Copa, mas essa é a posição no DOM) | Depois de Probabilidades (posições 6–7) | Depois de Probabilidades (posições 5–6) | `CONSISTENT` (corrigido) | Movidos para logo após Ranking nos dois apps; "Tabela" (BR2026, sem equivalente na Copa) manteve posição relativa, logo antes de Jogos |

Apenas markup (`index.html`), sem mudança de `app.js`/CSS — nada depende da ordem do DOM
(navegação usa `data-section`, não índice/posição). Verificado via Playwright: zero erros de JS
nos três apps depois da mudança, ordem do nav lida diretamente do DOM confirmada igual à Copa
(com a exceção intencional de "Tabela" no BR2026).

## Nota manual — Cutoff: fonte do valor, mecanismo diferente por app mas mesma regra de negócio (2026-07-14, BR2026 v1.31 / CDB2026 v3.12)

Eduardo confirmou a mesma regra de negócio para os 3 apps: **cutoff = 1h antes do início do
primeiro jogo**. O MECANISMO para chegar nesse valor é, intencionalmente, diferente em cada app —
propagar um mecanismo idêntico entre os três seria errado, porque a estrutura de dados por trás
de "o primeiro jogo" é diferente em cada um:

- **Copa** (`bolao/`): bracket fixo desde o deploy (`data.js`), com datas conhecidas anos de
  antecedência via calendário oficial da FIFA — nunca muda depois de publicado. Um `cutoffIso`
  estático é correto e suficiente aqui; **não precisa** do mecanismo de auto-cálculo/congelamento
  dos outros dois apps. `TOURNAMENT_SPECIFIC`, não propagado.
- **BR2026** (`bolao/br2026/`): temporada contínua com calendário ao vivo via ESPN (jogos podem
  ser reagendados pela CBF). Um valor estático (`cutoffIso`) ficou defasado silenciosamente em
  v1.11–v1.30 (bug real, ver `PROJECT_MEMORY.md`). Corrigido em v1.31: `nextUpcomingGame()` calcula
  o primeiro jogo real ainda não realizado, e o cutoff (1h antes) é **congelado uma única vez** em
  `s.cutoffAt` assim que o calendário carrega pela primeira vez — sem esse congelamento, o "próximo
  jogo" avançaria a cada rodada e reabriria entradas já fechadas.
- **CDB2026** (`bolao/cdb2026/`): mata-mata com fases cadastradas incrementalmente pelo admin
  conforme cada sorteio real acontece. Corrigido em v3.12: `entryCutoffMs()` calcula 1h antes do
  kickoff mais cedo conhecido na fase ativa (não existe um "congelamento" separado porque o próprio
  conjunto de confrontos da fase ativa não muda depois de sorteado — apenas kickoffs específicos que
  ainda faltam ser conhecidos vão sendo preenchidos, e a fase muda só quando o admin avança para a
  próxima). **v3.12–v3.17 davam prioridade incondicional a um `cutoffAt` manual do admin sobre o
  auto-calculado — essa ambiguidade foi a causa raiz de pelo menos três incidentes de produção no
  mesmo dia (2026-07-14, ver `PROJECT_MEMORY.md`). Removida em v3.18**: o auto-calculado agora
  SEMPRE vence quando existe kickoff conhecido; `cutoffAt` manual virou fallback só para fase sem
  kickoff nenhum ainda — elimina a ambiguidade manual-vs-auto que a Copa nunca teve.

**Decisão: `INTENTIONALLY_DIFFERENT` no mecanismo, `CONSISTENT` na regra de negócio.** Nenhuma
propagação adicional necessária — cada app já usa o mecanismo certo para sua própria estrutura de
dados. Lição registrada em `PROJECT_MEMORY.md`: a correção do CDB2026 (mesmo dia, horas antes)
deveria ter disparado a checagem "essa mesma classe de bug existe nos outros apps?" imediatamente,
não só depois que Eduardo encontrou o BR2026 quebrado separadamente.

## Nota manual — fases já concluídas fora do formulário de palpites: `TOURNAMENT_SPECIFIC`, não propagado (2026-07-14, CDB2026 v3.8)

CDB2026 ganhou (v3.7/v3.8) uma feature nova: fases 100% decididas (`phaseFullyResolved()`) ou sem
confronto cadastrado por estarem fora do escopo de população (`DATA.phasesConcludedNoData`) somem
do formulário de palpites, com nota de "já concluída" na aba Jogos em vez de "aguardando sorteio".

**Decisão: `INTENTIONALLY_DIFFERENT` / `TOURNAMENT_SPECIFIC` — não propagado para Copa nem
BR2026.** Motivo: a feature resolve um problema estrutural específico do modelo de fases dinâmicas
do CDB2026 (9 fases cadastradas incrementalmente pelo admin conforme cada sorteio real acontece,
ver `CDB2026_RULES_AND_MODEL.md`) que simplesmente não existe nos outros dois apps:

- **Copa** usa um bracket fixo desde o deploy (`data.js`, `knockoutMatches`) com um único
  `cutoffIso` global para todos os palpites de uma vez — não há conceito de "fase" que possa ter
  ficado pra trás antes do bolão existir.
- **BR2026** é uma tabela de temporada única (classificação ao vivo via ESPN), sem fases nem
  cutoff por rodada — mesma ausência de estrutura equivalente.

Nenhum dos dois tem o problema que motivou a feature (fases que a CBF já encerrou antes do bolão
ir ao ar aparecendo como "aguardando sorteio", enganoso, e abertas a palpite sem terem o que
apostar). Nada a propagar.

## Nota manual — Item 8/10 resolvidos: "Ver palpites" e comprovante alinhados com a Copa nos 3 apps (2026-07-14, BR2026 v1.34 / CDB2026 v3.15)

Os itens 8 e 10 da matriz automática (linhas 32 e 34 acima) estavam desatualizados: diziam que o
BR2026 não tinha nenhum sistema de comprovante, o que já não era verdade antes desta sessão (o
BR2026 já enviava e-mail, só que com layout/formato de código próprio, divergente da Copa e do
CDB2026). Eduardo reportou isso diretamente ("o email de comprovante do BR2026 é diferente do da
CDB2026 ... isso está quebrando uma das regras"). Corrigido nos dois apps:

- **Formato do código do comprovante**: BR2026 e CDB2026 agora usam `hashString()`/`receiptCode()`
  idênticos ao da Copa (FNV-32), só trocando o prefixo (`BR2026-`/`CDB2026-` em vez de `BOLAO-`).
- **Layout do e-mail**: os dois passaram a usar o mesmo HTML-base da Copa (tema claro, classes
  `.doc`/`.meta`/`.code`/tabela/`.notice`), com conteúdo específico do torneio dentro da mesma
  moldura (tabelas G4/SA6/Z4 no BR2026; tabela de confrontos + cartões campeão/vice no CDB2026).
- **Cópia para o admin**: BR2026 não enviava cópia para o admin (Copa e CDB2026 já enviavam) —
  agora envia, igual aos outros dois.

**Também descoberto e corrigido no mesmo patch** (não estava catalogado como item separado):
nem BR2026 nem CDB2026 escondiam o painel "Ver palpites" antes do prazo de corte — qualquer
participante podia ver o palpite de qualquer outro a qualquer momento (a Copa já tinha essa
proteção via `hideFuturePicks`). Ver `PROJECT_MEMORY.md`, seção "Consistência de 'Ver palpites' e
email + bug de cutoff manual travando Oitavas" para o detalhamento completo, incluindo o bug de
cutoff manual desatualizado que causou dois reports de produção no CDB2026 no mesmo dia.

**Decisão: item 8/10 passam de `NEEDS_REVIEW` para `CONSISTENT`** (formato/layout alinhados nos
3 apps). A tabela automática acima não foi reescrita manualmente (é substituída inteiramente na
próxima auditoria automatizada, por design — ver topo do arquivo); esta nota registra a resolução
até lá. Item 68 (estrutura do card de Ranking) também fica reforçado: a estrutura `.rank-row`/
`.picks-detail` já estava `CONSISTENT` desde antes, mas o **conteúdo** dentro do detalhe
(`renderPickDisplay()`) ainda usava cards bespoke em BR2026/CDB2026 — agora usa `<table>` igual à
Copa nos 3 apps, sem lacuna remanescente.

## Nota manual — CDB2026: automação de RESULTADO autorizada explicitamente por Eduardo, `TOURNAMENT_SPECIFIC` não propagado (2026-07-14, CDB2026 v3.16)

Eduardo pediu para automatizar a atualização de placar do admin do CDB2026. Antes de implementar,
foi perguntado explicitamente (via `AskUserQuestion`) se a intenção era manter manual (mais seguro,
comportamento até então) ou automatizar também o resultado (risco documentado: decide pagamento;
casar a perna errada num confronto de ida/volta seria grave — ver `CDB2026_RULES_AND_MODEL.md` §7).
Eduardo escolheu automatizar mesmo com o risco apresentado. Autorização explícita registrada —
satisfaz `PLATFORM_GOVERNANCE.md` ("nunca alterar regra de negócio sem autorização explícita do
Eduardo").

**Decisão: `TOURNAMENT_SPECIFIC`, não propagado para Copa nem BR2026.** Motivo: nenhum dos outros
dois apps tem a estrutura de dados que motivou a mudança —

- **Copa** usa um bracket fixo desde o deploy (`data.js`), sem sincronização com ESPN nenhuma — o
  conceito de "resultado vindo automaticamente de uma API externa" não existe lá.
- **BR2026** não é um mata-mata — não há "confronto"/"perna"/"travar resultado" no seu modelo,
  é uma projeção de classificação calculada sobre a tabela ao vivo do Brasileirão inteiro, sem
  eventos individuais para sincronizar.

Ver `PROJECT_MEMORY.md` (seção "CDB2026: automação da captura de RESULTADO") e
`bolao/cdb2026/CHANGELOG.md` v3.16 para o detalhamento técnico completo das salvaguardas
implementadas para mitigar o risco original.

## Nota manual — BR2026 "Projeção do Bolão": `TOURNAMENT_SPECIFIC`, não propagado (2026-07-14, BR2026 v1.35)

Ranking do BR2026 reenquadrado como projeção explícita (título/subtítulo/disclaimer + índice de
precisão informativo `accuracyMetrics()`) — ver `docs/bolao/BR2026_PROJECTION_MODEL.md`.

**Decisão: `TOURNAMENT_SPECIFIC`, não propagado para Copa nem CDB2026.** Nenhum dos outros dois
apps tem o problema que motivou a mudança: a Copa tem um bracket com jogos que realmente terminam
(pontuação real desde o primeiro resultado, nunca "projetada" contra uma tabela de terceiros); o
CDB2026 pontua confronto a confronto conforme os jogos reais acontecem, também sem depender de uma
tabela externa em progresso. Só o BR2026 pontua com base numa classificação de terceiros
(Brasileirão inteiro) que só termina no fim da temporada — daí a necessidade única de deixar claro
que o número exibido durante a temporada é uma projeção, não um resultado.

## Nota manual — Auditoria de governança de plataforma: header/nav, botões, forms, payment, rules (2026-07-14)

Auditoria direcionada (não substitui o bloco `AUTO:CONSISTENCY_MATRIX` completo, que exige
regeneração automatizada full-scope) pedida por Eduardo para consolidar governança permanente da
plataforma. Ver `docs/bolao/PLATFORM_DESIGN_SYSTEM.md` (novo), `docs/bolao/PLATFORM_ARCHITECTURE.md`
(novo), `docs/bolao/UI_REGRESSION_PROTOCOL.md` (novo).

**Status antes → depois:**

| Componente | Antes | Depois | Divergência | Severidade | Próxima ação |
|---|---|---|---|---|---|
| Botões (`.secondary`/`.danger`/`.small-btn`) | Não auditado formalmente | `CONSISTENT` | Nenhuma — classes idênticas, mesmos valores CSS nos 3 apps | — | Nenhuma |
| Payment card (`.pay-grid`/`.pay-card`) | Não auditado formalmente | `CONSISTENT` | Nenhuma — BR2026/CDB2026 têm comentário explícito "mesmo tratamento visual da Copa" | — | Nenhuma |
| Rules section (`#rules`/`.section-head`) | Não auditado formalmente | `CONSISTENT` | Nenhuma — HTML idêntico nos 3 apps | — | Nenhuma |
| Form/input (`label`/`input`/`select`) | Não auditado formalmente | `CONSISTENT` | Nenhuma — mesmo padrão, mesmos tokens (ver `PLATFORM_DESIGN_SYSTEM.md`) | — | Nenhuma |
| Nav — nº de abas visíveis | `NEEDS_REVIEW` | `INTENTIONALLY_DIFFERENT` | Copa esconde "Participantes" e "Pagamento" do nav — BR2026/CDB2026 mostram as duas. Resolvido por investigação de histórico (ver nota abaixo): decisão deliberada, não bug | Low (resolvido) | Nenhuma — ver rationale abaixo |

**Componentes já unificados em sessões anteriores no mesmo dia** (não re-auditados do zero aqui,
apenas confirmados como ainda válidos): ranking shell (`.rank-row`/`.picks-detail`, item 68),
comprovante/e-mail (item 8/10), "Ver palpites" como `<table>` (nota de 2026-07-14 acima).

**Diferenças intencionais confirmadas nesta rodada**: item de nav acima, resolvido via
`git log -S` (ver nota "Nav — Participantes/Pagamento ocultos na Copa" abaixo).

**Risco residual**: nenhum — o único item em aberto desta rodada foi resolvido.

**Regra de propagação aplicada**: mudanças desta rodada foram só documentação (`CLAUDE.md`,
`docs/bolao/PLATFORM_DESIGN_SYSTEM.md`, `PLATFORM_ARCHITECTURE.md`, `UI_REGRESSION_PROTOCOL.md`,
`QA_MASTER_CHECKLIST.md`) — nenhum código de app alterado, nada para propagar via changelog de
app individual.

## Nota manual — Nav: "Participantes"/"Pagamento" ocultos na Copa é decisão deliberada, não bug (resolvido 2026-07-14)

O item `NEEDS_REVIEW` da rodada de auditoria acima (nav com nº de abas visíveis diferente entre
apps) foi investigado via `git log -S` no lugar de perguntar ao Eduardo — a resposta já estava no
histórico do repositório.

**Achado**: `git log -S 'data-i18n="navParticipants" style="display:none"' -- bolao/index.html`
aponta pro commit `836e965` ("feat(v4.88): deadline 4 jul 12h ET + hide Participantes/Pagamento
nav", 2026-07-04). O `CHANGELOG.md` da Copa (entrada v4.88) documenta o motivo explicitamente:
"Botões 'Participantes' e 'Pagamento' ocultos na nav (site está no modo Ranking+Palpites agora)".

**Rationale**: "Participantes" (lista de quem entrou) e "Pagamento" (como pagar) só importam
durante a fase de inscrição. Uma vez o prazo de entrada encerrado (a Copa fechou pra novas
entradas no R32), ninguém mais precisa saber "como pagar" — o site pivota pra focar em
Ranking+Palpites, que é o que resta relevante durante o mata-mata. Simplificação de UX ligada ao
CICLO DE VIDA do bolão, não ao componente em si.

**Decisão: `INTENTIONALLY_DIFFERENT`, não propagado.** BR2026 e CDB2026 estão os dois ainda na
fase de inscrição (não publicados, torneios não começaram) — "Participantes"/"Pagamento" continuam
diretamente relevantes pra quem está decidindo se entra ou não. Esconder essas abas agora, em
qualquer um dos dois, removeria funcionalidade que participantes realmente precisam hoje —
errado na direção oposta do que a Copa fez. **Nenhum código alterado** em nenhum dos três apps:
Copa já está correta (decisão de 10 dias atrás, ainda válida), BR2026/CDB2026 já estão corretos
(ainda em fase de inscrição).

**Padrão registrado para o futuro, não implementado agora**: quando o prazo de entrada de BR2026
ou CDB2026 encerrar de verdade (fim da fase de inscrição de cada um), o mesmo padrão da Copa
(esconder "Participantes"/"Pagamento" da nav, pivotar pra Ranking+Palpites) é o comportamento
correto a replicar — ligado ao ciclo de vida de CADA torneio, não algo pra fazer hoje.

## Nota manual — item 24 resolvido: jogo ao vivo agora bate com a Copa nos três apps (2026-07-15, BR2026 vX / CDB2026 v3.25)

Auditoria pedida por Eduardo comparando o recurso de "jogo ao vivo" (placar/relógio em tempo
real) entre os três apps, com o BR2026 se aproximando. Achados (simulação manual com payloads
reais da ESPN, sem acesso de rede a hosts externos neste ambiente):

- **CDB2026 (achado alto)**: não existia NENHUMA experiência de jogo ao vivo — só sincronização
  de resultado FINAL a cada 5 min, em segundo plano. Como as Oitavas são mata-mata real (jogo
  real dia 1º de agosto, prorrogação/pênaltis genuinamente possíveis), era a maior divergência
  real da plataforma vs. a Copa.
- **BR2026 (achado médio)**: tinha placar/relógio ao vivo, mas sem nenhuma detecção de intervalo
  (halftime) nem proteção contra o relógio andar pra trás por lag da ESPN — o filtro de partida
  ao vivo só olhava `state === "in"`, que a ESPN mantém `"in"` durante o intervalo também (o
  campo que muda é `type.name`, granular). Sem tratamento, o relógio subia e descia durante o
  intervalo inteiro (~15min) num "serrote" visual, sem nunca mostrar "Intervalo".
- **Copa**: referência, mas o próprio Eduardo confirmou que o relógio dela "ainda não está 100%"
  — aceito como está por enquanto ("até 2030 a gente arruma isso").

**Correção**: portado quase literalmente da Copa (mesmos nomes de função — `formatMatchClock`,
`mergeLiveClock`, `detectClockPaused`, mesmas constantes de boundary/stoppage) pros dois apps,
por pedido explícito do Eduardo ("tem que bater exatamente com o da Copa"):
- BR2026: `fetchScoreboard()`/`pollAll()` ganharam detecção de intervalo/pênaltis + relógio
  monotônico com cache persistido; `renderLiveCard()`/`renderNextGameCard()` compartilham a
  mesma função `liveClockDisplay()`.
- CDB2026: recurso novo do zero — `fetchEspnCandidates()` estendida com campos ao vivo
  (`state`/`clockSec`/`period`/`isHalftime`/`isPenalties`) sem tocar nos campos que
  `autoSyncEspn()`/`autoSyncEspnResults()` já usavam; `fetchLiveTies()`/`pollLiveTies()` casam
  cada perna de cada confronto da fase ativa por identidade de mandante (mesmo padrão de
  `autoSyncEspnResults`); novo card `#liveTieCard`, poll de 60s separado do sync de resultado
  final de 5 min (concerns diferentes: exibição em tempo real nunca grava nada no
  estado/Supabase). Mantido o tratamento COMPLETO de period 3/4/5 (prorrogação/pênaltis) — ao
  contrário do BR2026 (liga, sem essa possibilidade), aqui é real.

**Decisão: `CONSISTENT`, propagado nos dois apps.** Mesma lógica, mesmos nomes de função, mesmo
comportamento (incluindo a mesma imperfeição conhecida e aceita da Copa — reset de período pode
mostrar o relógio brevemente "pausado" por um ciclo de poll até se autocorrigir, não um bug novo
introduzido aqui). `audit_scoring.py` passou — mudança é só de exibição, nunca grava
placar/resultado oficial.

## Nota manual — itens 7/16/25/44/50 resolvidos; matriz estava desatualizada em vários pontos (2026-07-15, BR2026 v1.37 / CDB2026 v3.26)

Eduardo pediu para implementar tudo que estava `NEEDS_REVIEW`, com pouco tempo disponível.
Antes de implementar, verifiquei cada item contra o CÓDIGO REAL (não só o texto da matriz, que é
regenerada por auditoria e pode ficar desatualizada entre uma rodada e outra) — achado: vários
itens já tinham sido resolvidos por outra sessão em paralelo e não precisavam de nova correção:
**#8/#10 (comprovante/e-mail do BR2026)**, **#14 (CSV CRLF do BR2026)**, **#23 (listener de
`focus` do BR2026)** e **#36 (QR Zelle do BR2026)** já estavam implementados no código atual.

Implementados nesta rodada (genuinamente ausentes, confirmado por leitura direta do código):
- **#7/#16 (BR2026)**: botão "Limpar tudo" + backup JSON bruto, portados do CDB2026.
- **#25 (CDB2026)**: detecção de jogo adiado/cancelado, portada do BR2026.
- **#44 (CDB2026)**: chip de status `.game-status` (live/post/pre/postponed), portado do BR2026
  — resolve de quebra a maior parte do item também para o BR2026, que já tinha o componente mas
  sem cobertura total (agora os dois batem).
- **#50 (BR2026 e CDB2026)**: `AbortController`/timeout nas chamadas ao Supabase, que usavam
  `fetch()` cru sem timeout — só as chamadas à ESPN já tinham. Novo `fetchJson()` genérico nos
  dois apps (CDB2026 não tinha nenhum wrapper genérico ainda, só o inline em
  `fetchEspnCandidates()`).

**Ainda pendentes, não implementados nesta rodada** (ver notas separadas abaixo para
detalhamento e progresso): #1 (audit_scoring.py equivalente para BR2026/CDB2026), #9 (fluxo de
PDF/popup do comprovante).

**Deliberadamente NÃO tocados nesta rodada específica**, por já estarem registrados como decisão
consciente e não bug: #62 (`--red` diferente entre Copa e BR2026/CDB2026 — mudança visual
isolada, não patch em lote) e #78 (`.admin-row` lista densa vs. card — decisão de UX já
documentada). Uma mudança em lote como esta não era o contexto certo pra reabrir decisões já
tomadas deliberadamente. **Ambos posteriormente fechados em PR120-final review item 5
(2026-08-03) — ver "Progresso — PR120-final review item 5" acima.**

`audit_scoring.py`: PASSOU nos dois apps em cada etapa — nenhuma mudança tocou scoring.

## Nota manual — item 1 resolvido (audit_scoring.py para BR2026/CDB2026); Pot movido pro lugar certo (2026-07-15, BR2026 v1.39 / CDB2026 v3.28)

Eduardo apontou, depois da correção de Participantes, que o Pot também estava em lugar errado
("o pot na copa nao esta igual nos outros dois") e deixou claro o padrão geral: **tudo precisa
permanecer 100% igual à Copa a não ser que não se aplique** (diferença de torneio genuína).

- **Pot**: estava só na barra de estatísticas de Participantes (sem equivalente na Copa). Movido
  para `.pot-box` no cabeçalho do Ranking (`#potValue`), exatamente onde/como a Copa mostra.
  A barra de estatísticas inteira (total de entradas/pagas/pot) foi removida nos dois apps — não
  tinha equivalente na Copa e não era diferença de torneio, só um acréscimo que a rodada anterior
  desta mesma auditoria erroneamente manteve como "aditivo, não conflita".
- **Item 1 (audit_scoring.py)**: `bolao/br2026/scripts/audit_scoring.py` e
  `bolao/cdb2026/scripts/audit_scoring.py` criados — transcrições Python das fórmulas reais de
  scoring de cada app (G4/Z4/SA6 no BR2026; placar por partida + bônus de confronto/pódio no
  CDB2026), 5 checagens cada, todas passando. Diferente do script da Copa (que audita
  `send_result_email.py`, uma reimplementação independente rodando via cron, contra o site — o
  risco ali é drift entre duas implementações): nem BR2026 nem CDB2026 têm um script server-side
  equivalente rodando sem supervisão, então não existe "segunda implementação" pra comparar. O
  valor desses dois scripts novos é ser uma suíte de regressão que precisa ser atualizada à mão
  junto de qualquer mudança de scoring em `app.js` — registrado explicitamente no docstring de
  cada script pra próxima sessão não confundir "audita drift" com "audita a própria transcrição".

**Lição consolidada**: ao aplicar uma correção de consistência, reavaliar tudo que foi
classificado como "aditivo"/"acréscimo aceitável" na MESMA auditoria com mais rigor — a barra de
estatísticas foi erroneamente aceita como aditiva na rodada anterior (mesma sessão, poucos
minutos antes) até o Eduardo apontar explicitamente que não deveria existir.

`audit_scoring.py` (Copa): PASSOU. `audit_scoring.py` (BR2026, novo): PASSOU. `audit_scoring.py`
(CDB2026, novo): PASSOU.

## Nota manual — item 67 revisitado: texto do badge "Pago" divergia da Copa (checkmark); rede de segurança contra scroll horizontal ausente nos 3 apps (2026-07-16, BR2026 v1.42 / CDB2026 v3.31 / Copa v4.137)

Item 67 já catalogava `.paid-badge` como `CONSISTENT` em CSS (pílula, padding, cores) — mas não
cobria o **texto**. Achado real via screenshot mobile do Eduardo: BR2026/CDB2026 usavam
`"✓ Pago"` (com checkmark) enquanto a Copa usa só `"Pago"` (`paymentPaid` em
`bolao/js/i18n.js`). O glyph "✓" renderiza com métricas de fonte diferentes do texto latino ao
redor, inflando visivelmente a altura da pílula no mobile — motivo real do "look and feel meio
off" reportado. Corrigido nos dois apps para igualar a Copa exatamente.

Achado separado, mesma sessão: nenhum dos 3 apps tinha `overflow-x: hidden` em `html`/`body` —
Eduardo reportou a página rolando para o lado no mobile (texto cortado nas duas bordas
simultaneamente, sintoma clássico de `body` mais largo que o viewport). Não foi possível isolar
o elemento causador exato dentro do sandbox (sem acesso de rede à ESPN/Supabase para reproduzir
o estado ao vivo exato do usuário), então a correção aplicada foi a rede de segurança padrão da
indústria — `overflow-x: hidden` no `html`/`body` dos 3 apps — que elimina o sintoma
independentemente da causa raiz específica, sem quebrar nenhum scroll horizontal interno
intencional (`.standings-wrap`, `.picks-detail`, `.table-scroll`, verificado via Playwright) nem
o header sticky.

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — mudança é só CSS/i18n de exibição.

## Nota manual — item 67 revisitado de novo: Pago/Pendente aparecia no ranking público (BR2026/CDB2026), divergente da Copa; "Ver palpites" sem gate de visibilidade (2026-07-16, BR2026 v1.43 / CDB2026 v3.32)

Mesma área do item 67 (badge de pagamento), achado diferente desta vez: a Copa nunca mostrou
Pago/Pendente na linha do ranking (só na aba Participantes) — BR2026 e CDB2026 tinham divergido,
mostrando o badge nas duas abas. Eduardo: "nao precisa pago e pendente, so para o admin."
Removido da linha do ranking nos dois apps; Participantes continua mostrando (transparência
pública já documentada, sem mudança aí).

Achado relacionado, mesma tela: o botão "Ver palpites" sempre aparecia no ranking, mesmo antes
do prazo — o conteúdo já estava protegido (`renderPickDisplay()` mostra mensagem "escondido até
o prazo"), mas o botão em si não tinha gate, virando um toque morto pré-prazo. Corrigido: botão
e painel de detalhe só renderizam quando o prazo relevante já passou (`isPastCutoff()` no
BR2026, `isPastEntryCutoff()` no CDB2026 — prazo da fase ativa).

Também nesta sessão: novo recurso de expandir/colapsar por jogo no card "ao vivo" do BR2026
(`renderLiveCard()`), motivado pelo formato de liga do Brasileirão — a rodada final geralmente
tem todos os jogos simultâneos (até 10 de uma vez, 20 times). Não propagado ao CDB2026 (mata-mata
raramente tem tantos jogos simultâneos) nem à Copa (grupos no máximo 2-4 simultâneos, já bem
servido pelo grid `flex-wrap` existente) — registrado aqui como `INTENTIONALLY_DIFFERENT` até que
um dos outros dois apps realmente precise do mesmo tratamento.

## Nota manual — item novo: triple confirmation + journal + backups para ações destrutivas do admin manual (BR2026/CDB2026), propagando padrão já existente na Copa (2026-07-16, BR2026 v1.44 / CDB2026 v3.33)

Contexto: Eduardo pediu para remover os controles manuais de resultado do admin do BR2026/CDB2026
("essas funções não são necessárias, tudo deve ser automatizado"), depois reverteu antes de
qualquer código ser tocado ("it doesn't hurt to have and don't want to waste tokens on this") — os
controles manuais continuam existindo nos dois apps, sem remoção. Em seguida pediu, em vez disso,
proteção contra mis-click (mobile) e um jeito de reverter: "make sure there's triple confirmation
if I click incorrectly it can be rolled back easily... what I want to avoid is to fat finger
something... we need to have a way to journal this so it can be rolled back if needed... the same
way copa has, this also needs to have backups done."

A Copa já tinha três camadas de proteção que BR2026/CDB2026 não tinham:

| Camada | Copa (antes) | BR2026/CDB2026 (antes) | BR2026/CDB2026 (depois) |
|---|---|---|---|
| Confirmação antes de ação destrutiva | `confirm()` único por ação | `confirm()` único por ação | **Triplo**: dois `confirm()` + um `prompt()` exigindo digitar a palavra `CONFIRMAR` — o terceiro passo é o que resiste a mis-click/fat-finger em série, não só repetição de `confirm()` |
| Journal de ações (`s.auditLog`) | Sim — registra edições de participante (antes/depois), mesclado por timestamp entre dispositivos, exibido no admin (`renderAdminAuditLog`) | Não existia | Sim — novo `appendAdminAuditLog()`, registra as ações destrutivas do admin manual (remover confronto, lançar/editar placar de partida, travar/destravar resultado — CDB2026; travar/destravar resultado — BR2026) com detalhe suficiente para saber o que reverter. Mesmo padrão de merge (`mergeStates`) e mesmo cap de 200 |
| Backup manual (botão admin, download JSON) | `backupJson()`/`backupCsv()` | `exportJsonBackup()` já existia (equivalente ao JSON da Copa, sem o CSV) | Sem mudança — já cobria isso |
| Backup automatizado (script + cron) | `bolao/scripts/backup.py` (git tag + snapshot Supabase, uso manual) e `backup_daily.py` (cron 01:00 AM EDT, dedup por hash, retenção de 60 dias) — só cobria `id="main"` | Não cobertos | Os dois scripts agora iteram sobre os três apps (`main`/`br2026`/`cdb2026`) na mesma execução — **o mesmo cron existente passa a cobrir os três sem precisar de entrada nova**. Arquivos prefixados por app em `bolao/backups/` (já no `.gitignore`) |

`INTENTIONALLY_DIFFERENT` preservado: a granularidade do journal da Copa (diff de picks de
participante) não foi copiada para BR2026/CDB2026 — o journal novo neles é escopado só às ações
do admin manual (o que o pedido do Eduardo cobria), não a edições de participante, que já têm seu
próprio fluxo de confirmação por e-mail em cada app. Não é dívida técnica; é escopo deliberado.

Não alterado: lógica de torneio, scoring, bracket, regra de avanço — patch é só de segurança
operacional do admin, nenhuma fórmula de pontuação foi tocada nos três apps.

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — nenhuma mudança de scoring/bracket.

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — mudanças são só de exibição/UX.

## Nota manual — `main` com 80px de padding-bottom sobrando (vão vazio no final de toda página), divergente da Copa (2026-07-16, BR2026 v1.47 / CDB2026 v3.35)

Eduardo: "There's a lot of empty space (non urgent) at the very bottom of the page." BR2026 e
CDB2026 tinham `main { padding: ...px ...px 80px; }` (base e mobile) — a Copa (referência visual
canônica) usa `20px` desktop / `12px` mobile, sem valor especial de bottom, apesar de ter a
mesma estrutura de botão sticky (`.sticky-submit`) no final do formulário de palpites. A folga
que o botão sticky precisa já vem do próprio `position: sticky`; os 80px extras só sobravam como
vão morto abaixo do conteúdo em toda aba (não só na de Palpites), porque `padding-bottom` é do
`<main>` inteiro, compartilhado por todas as seções.

`CONSISTENT` agora — os dois apps alinhados ao valor da Copa. Testado com Playwright (scroll até
o fim + screenshot antes/depois): `scrollHeight` mobile caiu ~68px em cada app (o delta exato
80px→12px), botão sticky sem sobreposição, aba Ranking sem regressão.

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — mudança é só CSS.

## Nota manual — `saveEntry()` sem validação de responsável/método de pagamento (BR2026/CDB2026), divergente da Copa desde sempre (2026-07-16, BR2026 v1.48 / CDB2026 v3.36)

Eduardo encontrou entradas reais salvas sem responsável e/ou método de pagamento (Matheus,
Gustavo) na aba Participantes do BR2026 — "This can not happen... doesn't look professional."
A Copa (`bolao/js/app.js`) sempre validou `payerName` e `paymentMethod` como obrigatórios
(`requiredPayerName`/`requiredPaymentMethod`); essa checagem nunca foi portada para BR2026 nem
CDB2026 quando os apps foram construídos — `saveEntry()` neles só validava `entryName` e
`participantEmail`. `NOT_CONSISTENT` → `CONSISTENT`: os dois apps agora bloqueiam o salvamento
com o mesmo alerta/posição de checagem que a Copa. Registros já salvos com o campo vazio não
foram corrigidos retroativamente (Eduardo confirmou que está OK deixar como está).

## Nota manual — `overflow-x: hidden` endurecido para `overflow-x: clip` nos três apps (2026-07-16, Copa v4.138 / BR2026 v1.48 / CDB2026 v3.36)

Eduardo: "the issue with the side scroll is back" — o mesmo sintoma resolvido em 2026-07-16
(item anterior, `overflow-x: hidden` no `html`/`body` dos três apps) reapareceu no BR2026,
mesmo com a regra ainda presente no CSS. Não foi possível reproduzir com Chromium no sandbox
(único engine disponível) em nenhuma largura testada — hipótese fundamentada: `.topbar` usa
`position: sticky` + `backdrop-filter` nos três apps, uma combinação com bug documentado no
WebKit onde `overflow-x: hidden` sozinho não impede o "rubber-band" horizontal do iOS Safari.
Trocado para `overflow-x: clip` (mais rígido, não cria região de scroll programável), com
`hidden` mantido como fallback na mesma declaração. `CONSISTENT` nos três apps.

**Correção especulativa, não confirmada por reprodução real** — registrado aqui para
acompanhamento: se o sintoma persistir depois deste patch, a causa é outra e precisa de
investigação com um dispositivo real ou engine WebKit, que este ambiente não tem disponível.

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — nenhuma mudança de scoring/bracket.

## Nota manual — badge/botão vazando da própria caixa: `.rank-row` reaproveitado por 2 estruturas incompatíveis nos três apps (2026-07-16, Copa v4.139 / BR2026 v1.49 / CDB2026 v3.37)

Eduardo: "the pago is outside the box. You should be very thorough about these knits." Diferente
das duas notas anteriores desta mesma sessão (side-scroll, overflow-x) — **esta teve causa raiz
confirmada por medição de DOM real, não é especulativa**. `.rank-row` (`display:grid`) é usado em
duas estruturas diferentes nos três apps:

| Uso | Itens | Coluna 3 (mobile, `max-width:900px`) |
|---|---|---|
| `renderRanking()` | 4: posição, nome, pontuação, botão "Ver palpites" | `40px` fixo — correto, dimensionado pro placar de 1-3 dígitos |
| `renderParticipants()` (3 apps) / `renderAdminPayments()` (só Copa) | 3: ícone, nome/detalhe, badge Pago/Pendente ou botão "Marcar como pago" | Também caía no mesmo `40px` fixo — **insuficiente**: "Pendente" mede 79px reais |

`NOT_CONSISTENT` → `CONSISTENT`: nova classe modificadora `.rank-row.participant-row`
(`grid-template-columns: 28px 1fr auto;`, 3 colunas reais, badge/botão com largura de conteúdo)
aplicada em `renderParticipants()` nos três apps e em `renderAdminPayments()` na Copa (única com
essa função usando `.rank-row` — BR2026/CDB2026 usam `.admin-row`, estrutura `flex` diferente,
não afetada). `renderRanking()` mantém `.rank-row` puro, comportamento inalterado.

Medição antes/depois (Playwright, `scrollWidth` do badge "Pendente" vs coluna do grid): antes,
badge forçado em 40px (texto de ~79px de largura real espremido/vazando); depois, 79px medidos,
13px de folga até a borda da linha. Essa é a terceira nota desta sessão sobre `.rank-row`
compartilhado entre Ranking e Participantes/Pagamentos — padrão a vigiar em qualquer novo reuso
futuro dessa classe.

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — mudança é só CSS/estrutura de classe.

## Nota manual — BR2026 ganha email automático de fim de rodada; `TOURNAMENT_SPECIFIC`, não propagado (2026-07-16, BR2026 v1.51)

Eduardo pediu email automático após cada rodada do Brasileirão terminar, "para economizar no
envio" comparado a um email por jogo. `INTENTIONALLY_DIFFERENT` — não propagado à Copa nem ao
CDB2026:

- **Copa** (`bolao/scripts/send_result_email.py`) já tem o equivalente por PARTIDA — funciona
  ali porque a Copa tem só ~32 partidas na vida inteira do torneio. Não faz sentido "agrupar em
  rodadas" numa fase de grupos com >36 jogos e depois um mata-mata de partida única.
  Volume baixo o suficiente que emailar por partida nunca foi um problema de custo.
- **CDB2026** é mata-mata (poucas dezenas de confrontos no total, ida/volta) — mesmo raciocínio
  da Copa, sem volume que justifique agrupamento.
- **BR2026** tem ~380 jogos/temporada (liga de pontos corridos, 20 times, turno e returno) — o
  único dos três apps onde emailar por jogo teria custo real (~380 envios × participantes,
  vs. ~38 em lote por rodada). É o único caso de uso que motivou essa mudança.

Achado técnico registrado para o futuro (caso outro app precise de algo parecido): a API da
ESPN não expõe número de rodada para o Brasileirão. Testado ao vivo contra o calendário real de
2026 (382 jogos) — nem clustering por data nem reconstrução por turno-returno produz rodadas
limpas (jogos adiados/remarcados e compressão pós-Copa do Mundo geram lotes de até 39 jogos).
Resolvido com uma janela rolante de 7 dias em vez de um calendário fixo de 38 rodadas
numeradas — ver `bolao/br2026/scripts/send_round_email.py` e `bolao/br2026/CHANGELOG.md` v1.51
para o detalhe completo.

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — mudança é só um script operacional
novo, reaproveita a fórmula de scoring já existente sem alterá-la.

## Nota manual — merge de `entries` sempre preferia cache local (BR2026/CDB2026), mesmo padrão do bug de `cutoffAt`; Copa já tinha a correção certa (2026-07-16, BR2026 v1.52 / CDB2026 v3.39)

Eduardo renomeou duas entradas do BR2026 direto no Supabase e reportou "não aparece ainda" —
confirmado que o banco estava correto, o problema era `mergeStates()`: `entries` em BR2026/
CDB2026 usava "local sempre vence" incondicional (`byId[e.id] = e`, remoto processado antes,
local sobrescrevendo por último) — a MESMA classe de bug do `cutoffAt` corrigida mais cedo hoje
(nota anterior), só que nunca propagada pra `entries`. A Copa (`bolao/js/app.js`) já tinha a
correção certa desde antes: preferir o registro mais recente por entrada (`updatedAt`/
`createdAt`), não um lado fixo. `NOT_CONSISTENT` → `CONSISTENT`: portado pra BR2026 e CDB2026.

## Nota manual — Probabilidades do BR2026 com % impossível (Remo 0% de rebaixamento em 18º); dois bugs reais confirmados com dados ao vivo, não propagado ao CDB2026 (2026-07-16, BR2026 v1.52)

Eduardo: "A tabela de probabilidades está bem fora. Mostra Remo por exemplo como 0% de chances
de rebaixamento!" Diferente das notas de side-scroll/overflow-x desta mesma sessão (aquelas
especulativas, sem reprodução confirmada), esta teve DOIS bugs reais confirmados investigando
com dados ao vivo da ESPN (schedule + standings reais, não simulados):

1. Nome de time divergente entre os dois endpoints da ESPN ("Athletico Paranaense" na
   classificação vs. "Athletico-PR" no calendário) — corrigido com mapa de alias
   (`ESPN_SCOREBOARD_NAME_ALIASES`), mesmo padrão do `ESPN_ALIASES` já usado em
   `bolao/scripts/send_result_email.py` (Copa).
2. O ajuste iterativo Dixon-Coles genuinamente diverge pra alguns times (confirmado: não é
   ruído, reduzir iterações/adicionar amortecimento não resolve) — mitigado com limite [0.25,3]
   + encolhimento de 70% em direção à média ingênua de gols/jogo no resultado final.

Verificado com o código REAL extraído de app.js (não uma reimplementação) contra dados ao vivo:
Remo Z4 0%→9%, Athletico Paranaense Z4 99%→G4 68%, tabela completa dos 20 times conferida.

`INTENTIONALLY_DIFFERENT`, não propagado ao CDB2026: usa Poisson bivariado direto por confronto
(mata-mata), sem o ajuste iterativo de força de time ao longo de uma temporada — essa classe de
bug (divergência de ajuste, nome de time entre dois endpoints de temporada) não existe lá.

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — só o cálculo informativo de
probabilidades foi alterado, nenhuma fórmula de pontuação.

## Nota manual — card "ao vivo" do BR2026: duplicação, plays feed, posição/movimento, centralização, threshold de prob-bar (2026-07-16, BR2026 v1.53)

Eduardo, olhando o card "ao vivo" do Ranking: "se ja esta mostrando ao vivo, nao precisa
mostrar duas vezes... nao esta mostrando o ranking pra cima ou baixo... adicionar o minuto a
minuto de cartoes, gols, substituicoes como tem na copa... centralizar... nos minutos do jogo
mostre o tempo que esta." Cinco itens, tratados juntos por tocarem a mesma função
(`renderLiveCard()`/`renderNextGameCard()`):

1. **Duplicação** (`todayGames` incluía jogos já ao vivo) — `NOT_CONSISTENT` → `CONSISTENT`:
   `renderNextGameCard()` agora exclui qualquer jogo cuja chave `homeTeam|awayTeam` já esteja
   em `_liveMatches`.
2. **Relógio do jogo** — investigado e descartado como bug separado: os valores estranhos
   ("13:42"/"11:42") eram a MESMA partida sendo renderizada duas vezes (item 1), não um erro na
   própria `formatMatchClock()`/`liveClockDisplay()` (essa lógica já foi auditada e portada
   quase literalmente da Copa em 2026-07-15). Corrigida a duplicação, o relógio já está certo.
3. **Movimento de posição de clube no card ao vivo** — na verdade já existia
   (`calculateLiveStandings()`/`standingsMovementHtml()`, shipped v1.4x só na tabela de
   Classificação); Eduardo não tinha visto lá. Reaproveitado no card "ao vivo" também (mesma
   baseline `_standingsBaseline`, nenhum cálculo novo).
4. **Plays feed** (gols/cartões/substituições por partida) — feature nova no BR2026, portada
   quase literalmente da Copa (`extractMatchPlays`/`livePlaysHtml`, mesmo endpoint já consultado
   a cada poll, mesmo contrato "falha silenciosa").
5. **Centralização** — `.live-match-row` mudou de linha única alinhada à esquerda pra coluna
   centralizada, mesmo em telas largas.

Durante o teste do item 4/5 (screenshot da barra de probabilidade cortando "Palmeiras 12%"),
achado um SEXTO bug não relacionado ao pedido original: as barras de probabilidade do card "ao
vivo" eram a única das 4 chamadas desse padrão neste arquivo sem o limiar de 12% pra esconder o
nome do time em fatias estreitas — corrigido no mesmo patch (ver CHANGELOG v1.53).

`INTENTIONALLY_DIFFERENT`, não propagado ao CDB2026: CDB2026 não tem card "ao vivo" nem polling
contínuo (mata-mata sincronizado sob demanda pelo admin, ver `bolao/cdb2026/js/config.js`
"Sincronização com ESPN") — essa classe inteira de bug/feature não existe lá. A Copa já tinha
plays feed + card centralizado antes do BR2026 (referência canônica, nada a propagar de volta).

`audit_scoring.py` (Copa/BR2026): PASSOU nos dois — mudança é só apresentação do card ao vivo
(dedupe, feed de lances, badge de posição, CSS, limiar de prob-bar), nenhuma fórmula de
pontuação tocada.

## Nota manual — ranking do BR2026 não reagia ao placar ao vivo (bug real); hero "Ranking ao vivo" adicionado; centralização ajustada (2026-07-16, BR2026 v1.54)

Segunda rodada de feedback sobre o mesmo card, depois do v1.53 já estar no ar (Eduardo olhando a
versão publicada): "esta ainda fora de centro... nao ta mostrando estilo copa conforme os jogos
estao ocorrendo qual a posicao no ranking as pessoas estao subindo ou descendo... isso poderia
vir num hero logo abaixo dos jogos ao vivo no mesmo estilo da copa."

1. **Bug real confirmado, não só cosmético**: `renderRanking()` calculava o "resultado atual"
   (pra pontuação/rank/setas) direto da tabela oficial `_standings`, nunca da tabela ajustada
   pelo placar ao vivo (`liveStandingsNow()`, que já existia desde antes só pro card ao vivo). As
   setas do Ranking ficavam presas na posição pré-jogo durante toda a partida. Corrigido com
   `currentResultSet()`, fonte única compartilhada agora por `renderRanking()` e pelo hero novo.
   Verificado com duas entradas de teste injetadas e um placar ao vivo real cruzando a fronteira
   do G4 — a entrada que passou a acertar sobe, a que passou a errar desce, como esperado.
2. **Hero "Ranking ao vivo"** — novo card, mesmo estilo do `hero-live-points` da Copa, logo
   abaixo do card "ao vivo". Zero cálculo novo (reaproveita `calculateRankingMovement()`); só
   aparece quando há alguém de fato subindo/descendo agora, escondido caso contrário (Eduardo
   autorizou explicitamente deixar de fora se ficasse "ruim ou muito busy" — decisão de design
   tomada a favor de mostrar, dado que reaproveita 100% de código já testado).
3. **Centralização**: `.live-match-detail` (feed de lances + barras de probabilidade) ganhou
   `max-width` centralizado — antes esticava pra largura inteira do card enquanto o cabeçalho
   acima (times/placar/posição) ficava numa faixa estreita centralizada, o contraste é que lia
   como "fora de centro", não a ausência de centralização em si (essa parte já tinha sido
   corrigida na v1.53).

`INTENTIONALLY_DIFFERENT`, não propagado ao CDB2026: mesma razão da nota anterior (sem card ao
vivo/polling contínuo lá). Não propagado à Copa: Copa já tem o padrão correto
(`liveMatchPointsTable()` sempre recomputado do zero a partir de dados ao vivo) — o bug era
exclusivo do BR2026, introduzido quando o Ranking foi construído reaproveitando `_standings` sem
notar que `liveStandingsNow()` já existia para esse propósito.

`audit_scoring.py` (Copa/BR2026): PASSOU nos dois — `currentResultSet()` escolhe QUAL tabela
alimenta `rankEntries()`/`scoreEntry()`, não altera a fórmula de pontuação em si.

## Nota manual — card "ao vivo" do BR2026 refeito copiando a estrutura real da Copa; hero de ranking mostra todo mundo (2026-07-16, BR2026 v1.55)

Terceira rodada de feedback sobre o mesmo componente. As duas rodadas anteriores (v1.53/v1.54)
tinham ficado só em ajuste de espaçamento/centralização de texto em cima de uma pilha vertical
inventada — nunca correspondiam à estrutura horizontal real do `hero-live-card` da Copa
(`bolao/css/styles.css`: escudo+nome+posição | placar | badge+relógio | placar |
escudo+nome+posição, tudo numa linha). Eduardo: "ficou horrivel isso! faca igual da copa do
mundo tche, voce sabe mais que isso." Refeito do zero copiando a estrutura E os tokens de
tamanho/espaçamento da Copa (`.hero-live-top/.hero-live-team/.hero-live-score/.hero-live-center`
→ `.live-top/.live-team/.live-score/.live-center`), não só o efeito visual aproximado. Com
múltiplos jogos ao vivo, agora são cards lado a lado (`flex-wrap`, mesmo padrão do
`.next-match-live-grid` da Copa), não mais empilhados numa caixa única.

Diferenças propositais preservadas (`TOURNAMENT_SPECIFIC`, não é falha de reprodução):
- Times não têm bandeira de país — usa escudo do clube (`teamLogoImg()`), já que BR2026 não tem
  seleções.
- Cor de destaque do card/badge/relógio continua o verde de marca já usado no resto da UI do
  BR2026 (a Copa usa vermelho de urgência para o card "ao vivo" especificamente) — mantido por
  ser o padrão já estabelecido em todo o resto do app antes desta mudança, não uma nova
  divergência introduzida agora.

Também corrigido no mesmo patch: o hero "Ranking ao vivo" (novo em v1.54) filtrava a lista pra
só quem estava subindo/descendo, o que na prática escondia o topo da classificação quando os
líderes não estavam entre os que se moviam — Eduardo: "no ranking so aparece da 4 posicao para
baixo, tem que aparecer todos, pode scrolar mas deixa pelo menos 4-5 no topo." Agora mostra
todas as entradas ordenadas por posição, com scroll e cabeçalho fixo.

`INTENTIONALLY_DIFFERENT`/não propagado ao CDB2026: mesma razão das duas notas anteriores (sem
card ao vivo/polling contínuo lá).

`audit_scoring.py` (Copa/BR2026): PASSOU nos dois — mudança inteira é estrutura/CSS do card ao
vivo e do hero de ranking, nenhuma fórmula de pontuação tocada.

## Nota manual — auditoria de consistência disparada pelo Eduardo ("PRECISAMOS SER CONSISTENTES!"): CDB2026 trazido ao mesmo padrão do card ao vivo do BR2026; bugs reais achados nos 3 apps (2026-07-16, Copa v4.141 / BR2026 v1.56 / CDB2026 v3.40)

Depois de aprovar o redesenho do card "ao vivo" do BR2026 (v1.55), Eduardo perguntou
diretamente: "aplicou as mesmas alteracoes na CDB2026? PRECISAMOS SER CONSISTENTES!" Auditando
CDB2026 de verdade (busca anterior tinha usado nomenclatura do BR2026 — `_liveMatches`/
`renderLiveCard` — e não encontrou o equivalente do CDB2026, que usa `_liveTies`/
`renderLiveTieCard`; falha de busca, não de existência): confirmado que o CDB2026 tinha a MESMA
funcionalidade ao vivo (poll de 60s, relógio, intervalo/pênaltis) só que ainda na pilha vertical
antiga, nunca atualizada. `NOT_CONSISTENT` → `CONSISTENT`: refeito com a mesma estrutura/tokens
(`.live-top/.live-team/.live-score/.live-center`) e o mesmo plays feed (gols/cartões/subs).

Também adicionado ao CDB2026 nesta rodada, a pedido explícito: "CDB no need to show up and down
for the teams as it is knock out, but up and down for the user ranking, yes" — hero "Ranking ao
vivo" + setas de movimento no Ranking, usando uma projeção ao vivo aditiva (`liveScoreEntry()`)
específica do modelo de pontuação por partida do CDB2026 (nunca reaproveitando a lógica de G4/Z4/
SA6 do BR2026 — diferença de torneio preservada, ver `PLATFORM_GOVERNANCE.md`).

Durante essa auditoria dirigida, mais bugs reais confirmados e corrigidos nos 3 apps ao mesmo
tempo (nenhum inventado — todos com screenshot ou frase específica de Eduardo):

1. **Relógio ao vivo com formato inconsistente** (screenshot: "51'" vs "52:24") — `liveClockDisplay()`
   trocava de formato ao pausar (string crua da ESPN, só minuto) vs rodando (MM:SS calculado).
   Mesmo bug em BR2026 e CDB2026 (código idêntico); Copa nunca teve essa bifurcação. Corrigido
   nos dois apps.
2. **Ranking com pontuação amarela + "↕"** no BR2026, divergente de Copa/CDB2026 (sempre verde,
   "pts" fixo) — Eduardo: "deveria ser igual copa e copa do brasil". `NOT_CONSISTENT` →
   `CONSISTENT`, removido do BR2026.
3. **"." sobrando no número de posição** (ex. "4.") nos TRÊS apps — Eduardo: "parece sujeira".
   Corrigido nos três ao mesmo tempo.
4. **"Próximo jogo" mostrava só 1 partida mesmo com várias no mesmo dia seguinte** — em BR2026 e
   CDB2026 (Copa não tem esse card no mesmo formato — mata-mata com datas conhecidas com
   antecedência, sem essa ambiguidade "hoje vs. próximo dia com jogo"). Corrigido nos dois com
   agrupamento por dia.
5. **`.visually-hidden` faltando no CSS do CDB2026** — achado testando a própria mudança desta
   rodada (item novo, hero de ranking), não uma regressão de produção: sem a classe, o texto de
   acessibilidade das setas de movimento aparecia visível na tela. Corrigido antes de publicar.

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — toda a rodada foi apresentação
(card ao vivo, ranking, relógio, hero) mais uma projeção ao vivo ADITIVA no CDB2026 (nunca
sobrescreve resultado oficial), nenhuma fórmula de pontuação alterada.

## Nota manual — pequenos bugs reais de UI achados por screenshot, corrigidos nos 3 apps: foco visível, contagem regressiva presa, ranking quebrando linha, contador do próximo jogo sumido (2026-07-17, Copa v4.142 / BR2026 v1.57 / CDB2026 v3.41)

Quatro achados pontuais na mesma rodada, todos com screenshot ou frase específica de Eduardo,
nenhum inventado:

1. **Caixa de foco visível ao redor do `<h2>`** ao trocar de aba — `showSection()` (idêntico nos
   3 apps) dá `tabindex="-1"` + `.focus()` no título da seção de propósito, pra leitor de tela.
   O anel de foco padrão do navegador ficava visível como uma caixa feia. `NOT_CONSISTENT` (nenhum
   dos 3 apps suprimia isso) → `CONSISTENT`: `h2:focus, h3:focus { outline: none; }` nos três.
2. **Caixa "Encerrado" ocupando o espaço vazio da contagem regressiva** — a Copa sempre escondeu
   a caixa inteira quando o prazo passa (`updateCountdown()`); BR2026 e CDB2026 tinham divergido,
   mostrando texto solto dentro da mesma caixa grande. `NOT_CONSISTENT` → `CONSISTENT`.
3. **Pontos do Ranking quebrando em 2 linhas** ("170" / "pts") no mobile — a coluna de pontos tem
   largura fixa de 40px (dimensionada só pros dígitos, pra o botão "Ver palpites" nunca deslocar
   conforme 1-3 dígitos), igual à Copa desde sempre. BR2026/CDB2026 tinham adicionado um sufixo
   " pts" que a Copa nunca mostrou ali, e que não cabia nessa largura. Removido dos dois.
4. **Contador regressivo do "Próximo jogo" sumiu no BR2026** — regressão real da v1.56 (nota
   anterior desta mesma matriz): ao agrupar jogos por dia, o caso "só 1 jogo no próximo dia"
   perdeu o layout rico (contador em dígitos + local) e passou a usar o item compacto de "jogos
   de hoje". Restaurado — layout rico quando há só 1 jogo, lista compacta quando há mais de 1
   (CDB2026 nunca teve essa regressão, foi construído já com os dois casos corretos).

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — toda a rodada é CSS/apresentação,
nenhuma fórmula de pontuação tocada.

## Nota manual — vão em branco no final da página (iOS), correção especulativa aplicada nos 3 apps por consistência (2026-07-17, Copa v4.143 / BR2026 v1.58 / CDB2026 v3.42)

Eduardo, screenshot: "Ainda tem bastante areas em branco ao final da pagina, isso tinha sido
corrigido." Investigação: reproduzido localmente com o estado REAL do Supabase do BR2026 (11
entradas, não dados fictícios) — nenhuma sobra de espaço encontrada no Chromium, rodapé
exatamente no fim da página em todas as abas. HTML/CSS de produção conferido byte a byte contra
o checkout local — idênticos. Sem acesso a um navegador WebKit/Safari real neste ambiente, não
foi possível confirmar a causa raiz com certeza.

Hipótese de trabalho, não confirmada: os três apps agora têm múltiplos cards que aparecem/somem
dinamicamente a cada poll de 60s (ao vivo, ranking ao vivo, próximo jogo/próxima partida,
contagem regressiva) — bug conhecido do WebKit no iOS faz a área rolável não ser recalculada
quando o conteúdo encolhe com a página rolada perto do final, deixando um vão "fantasma".
Aplicada `nudgeScrollReflow()` (um `scrollBy(0, 0)` imperceptível que força o WebKit a
recalcular) depois de cada ciclo de renderização nos três apps — correção padrão documentada
pra essa classe de bug, sem custo/efeito quando a página não está rolada. Propagada aos três
proativamente (não só onde o bug foi visto) porque o mecanismo — cards dinâmicos + poll
periódico — é idêntico nos três, incluindo a Copa (já tinha esse padrão antes desta sessão).

Se a correção não resolver, o próximo passo seria pedir a Eduardo pra testar se rolar
manualmente a página faz o vão desaparecer (confirmaria/descartaria a hipótese) — pergunta já
feita, sem resposta ainda quando esta correção foi aplicada (Eduardo pediu pra colocar em
produção direto).

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — mudança é só uma chamada de
`scrollBy(0,0)` depois de renderizar, nenhuma fórmula de pontuação tocada.

## Nota manual — "Jogos de hoje" sem contagem regressiva antes da última hora + alinhado à esquerda (2026-07-17, BR2026 v1.59 / CDB2026 v3.43)

Eduardo mandou screenshot com dados reais de produção (3 jogos hoje no BR2026) dizendo que a
contagem regressiva "sumiu" e o alinhamento estava errado. Investigado com o calendário real da
ESPN (não dados fictícios) — confirmado que não era regressão de bug, era comportamento por
design nunca notado antes: a lista compacta "Jogos de hoje"/"Próximos jogos" (usada quando há
mais de um jogo no mesmo dia) só mostrava contagem regressiva na última hora antes do jogo,
nada antes disso. Corrigido pra sempre mostrar alguma contagem (h+min quando falta mais de 1h,
min+seg na última hora). Também alinhamento: a lista inteira estava à esquerda, divergente do
padrão centralizado já estabelecido no card "ao vivo" (v1.55) — centralizado agora, nos dois
apps.

`INTENTIONALLY_DIFFERENT`, não propagado à Copa: a Copa não tem esse conceito de "lista compacta
de múltiplos jogos no mesmo dia" (mata-mata com calendário conhecido com antecedência, sem essa
ambiguidade "hoje vs. próximo dia com jogo" que motivou essa feature no BR2026/CDB2026).

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — mudança é só apresentação, nenhuma
fórmula de pontuação tocada.

## Nota manual — "Jogos de hoje"/"Próximo jogo": rótulo cinza (devia ser verde) + centralização da v1.59 revertida (2026-07-17, BR2026 v1.60 / CDB2026 v3.44)

Eduardo mandou screenshot da Copa (card "PRÓXIMO JOGO" real) e disse: "Mais uma vez erro de
consistência, olha como esta a copa faca igual em todos. Isso não deveria nem ser questionado."
Comparado direto contra o CSS real da Copa (`bolao/css/styles.css`), dois achados concretos:

1. **Rótulo cinza, devia ser verde** — `.hero-next-label` da Copa usa `color: var(--green)`;
   `.next-game-label`/`.today-games-header` no BR2026/CDB2026 usavam `var(--muted)` (cinza).
   `NOT_CONSISTENT` → `CONSISTENT`.
2. **Centralização introduzida ontem (v1.59) estava errada** — a nota anterior desta mesma
   matriz (2026-07-17, item "Jogos de hoje") centralizou a lista em cima de um pedido verbal
   vago ("tudo para a esquerda"), sem checar contra o padrão real da Copa. O componente
   equivalente real da Copa (`.next-match-info`/`.hero-next-*`) é alinhado à esquerda, com o
   contador de dígitos ocupando o lado direito da linha — nunca centralizado. Revertido.

Lição registrada para sessões futuras: ao receber um pedido verbal de ajuste visual (sem
screenshot do componente de referência da Copa), verificar o CSS real da Copa ANTES de
implementar, não depois — evita reverter trabalho no dia seguinte. A regra já existe em
CLAUDE.md ("Copa do Mundo 2026 é a referência visual canônica... reproduzir seus tokens"), mas
não foi seguida à risca na mudança de ontem.

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — mudança é só cor/alinhamento CSS,
nenhuma fórmula de pontuação tocada.

## Nota manual — "Jogos de hoje": widget de contagem regressiva trocado pelo componente exato da Copa, não só cor/alinhamento (2026-07-17, BR2026 v1.61 / CDB2026 v3.45)

Eduardo, depois da correção de cor/alinhamento: "A contagem regressiva tem que ser igual copa
meu!" — a correção anterior (nota acima, mesma data) tinha corrigido cor do rótulo e
alinhamento, mas a contagem em si continuava sendo um resumo em texto ("· em 10h 05m"), não o
MESMO componente visual da Copa (`countdownTimerHtml()`/`.count-grid`, caixas grandes em
dígitos). `NOT_CONSISTENT` → `CONSISTENT`: cada jogo da lista "Jogos de hoje"/"Próximos jogos"
agora usa o widget de dígitos completo (mesma função já usada no card de 1 jogo só), incluindo o
mesmo comportamento responsivo no mobile (empilha em vez de ficar lado a lado, herdado
automaticamente por reaproveitar a mesma classe CSS `.next-game-row`/`.next-game-timer`).

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — mudança é só apresentação (reaproveita
uma função já existente), nenhuma fórmula de pontuação tocada.

## Nota manual — "Próximo jogo"/"Ao vivo": faltava fase do torneio e local do jogo em todos os três apps (2026-07-17, Copa v4.144 / BR2026 v1.62 / CDB2026 v3.46)

Eduardo, screenshot do card real "Próximo jogo" da Copa (France × England, disputa do 3º lugar,
M103, Hard Rock Stadium — jogo real de amanhã 18/jul): "Falta a localização do jogo e qual
rodada estamos." Auditado o componente equivalente nos três apps (regra "toda vez que um
componente visual for alterado, localizar todas as ocorrências"):

- **Copa**: local (`m.venue`) já aparecia no card pré-live, mas a FASE do torneio
  (`phaseLabel(m.phase)`, ex. "Disputa do 3º lugar") nunca aparecia em nenhum estado do hero — só
  o número cru "M103". No card AO VIVO faltavam os dois (nem fase, nem local).
- **BR2026**: venue já aparecia no card rico de 1 jogo só, mas faltava na lista compacta "Jogos
  de hoje" (vários jogos no mesmo dia) e no card ao vivo (`fetchScoreboard()` nunca extraía
  `comp.venue` da ESPN, diferente de `fetchSchedule()` que já extraía).
- **CDB2026**: venue já aparecia no card de 1 confronto só, mas a FASE (`Oitavas de Final` etc.)
  nunca aparecia em nenhum formato, e venue também faltava na lista compacta e no card ao vivo.

`NOT_CONSISTENT` → `CONSISTENT` nos três: fase (Copa/CDB2026) e venue (BR2026/CDB2026, lista
compacta + ao vivo) agora aparecem em todo estado do card "próximo jogo"/"ao vivo", reaproveitando
helpers já existentes (`phaseLabel()`/`t("groupLabel")` na Copa, `phase.name`/`getPhaseDef()` no
CDB2026) — nenhuma lógica de torneio nova criada.

**Divergência preservada como `TOURNAMENT_SPECIFIC`**: BR2026 não tem conceito de "fase" (liga de
pontos corridos, não mata-mata) — "qual rodada estamos" não se aplica da mesma forma que na Copa
(fases de bracket) ou no CDB2026 (fases de eliminatória). Um número de rodada (matchday) do
Brasileirão seria um dado NOVO (não extraído hoje de lugar nenhum), não uma correção de
inconsistência — não implementado nesta rodada de mudanças por estar fora do escopo do pedido
original (local do jogo); registrado aqui como possível item de backlog, não como bug.

Verificado com estado real de produção (Supabase) nos três apps — Copa: M103 (França × Inglaterra,
3º lugar, Hard Rock Stadium) mostra fase + local corretamente, inclusive simulado ao vivo com
payload real da ESPN. BR2026: jogos reais de hoje (Bahia × Chapecoense, Fluminense × Bragantino,
Mirassol × Grêmio) mostram venue na lista compacta. CDB2026: Oitavas de Final reais (Vasco ×
Fluminense, Atlético-MG × Juventude, Santos × Remo) mostram fase + venue.

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — mudança é só apresentação (novas
linhas de texto/CSS reaproveitando dados e helpers já existentes), nenhuma fórmula de pontuação
tocada.

## Nota manual — horário de jogo mostra EST/EDT + BRT juntos, EST primeiro (2026-07-17, Copa v4.145 / BR2026 v1.63 / CDB2026 v3.47)

Eduardo: "Seria ideal botar o horário brt e est sendo est primeiro para não confundir o pessoal."
Pedido confirmado como aplicável aos três apps (pergunta feita ao Eduardo antes de implementar,
dado que mudava o escopo de forma relevante — Copa só mostrava ET, BR2026/CDB2026 só mostravam
BRT, então "adicionar o outro fuso" significa coisas diferentes em cada app).

- **Copa**: já mostrava só ET (`m.timeET`, dado oficial FIFA, ex. "17:00 (EDT)"). Adicionado BRT
  depois, derivado do mesmo epoch do contador (`parseMatchKickoff`) via novo helper
  `brtTimeFromKickoff()` — sem repetir conta de fuso na mão.
- **BR2026/CDB2026**: já mostravam só BRT. Adicionado EST/EDT ANTES do BRT via novo helper
  `estTimeStr()` (usa `Intl`/`America/New_York`, não offset fixo — diferente da Copa, essas duas
  ligas rodam o ano inteiro e cruzam a virada EDT/EST em novembro, a Copa é só jun/jul, sempre
  EDT).

Formato final igual nos três: `"HH:MM (EDT/EST) · HH:MM BRT"` (ou, no caso do BR2026/CDB2026,
`"HH:MM (EDT/EST) · <data por extenso>, HH:MM BRT"` quando a data completa também aparece).

`NOT_CONSISTENT` → `CONSISTENT`: os três apps agora mostram os dois fusos, na mesma ordem, em
todo lugar que mostra horário de partida (card "próximo jogo", lista de jogos, formulário de
palpites na Copa). Timestamps de SISTEMA (sync da ESPN, última rodada de Probabilidades, log de
auditoria) ficaram de fora de propósito — não são horário de jogo, fora do escopo do pedido.

Verificado com dados reais de produção (Supabase + ESPN) nos três apps via Playwright — Copa:
M103 mostra "17:00 (EDT) · 18:00 BRT". BR2026: jogos reais de hoje mostram "18:30 (EDT) · 19:30
BRT" etc. CDB2026: Oitavas de Final reais mostram "16:30 (EDT) · sáb., 01/08, 17:30 BRT" etc.

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — mudança é só apresentação (novo
helper de formatação de horário), nenhuma fórmula de pontuação tocada.

## Nota manual — bug real: local do jogo espremido no card ao vivo do BR2026 (2026-07-17, BR2026 v1.64)

Eduardo, durante um jogo real ao vivo (Bahia 1×0 Chapecoense, 21'): "Ta feio isso nao ta igual a
copa." Auditado e CONFIRMADO como bug real (não mal-entendido) introduzido pela própria mudança
de fase+venue no card ao vivo (v1.62/PR #82): `.live-match-meta` tinha sido colocada dentro de
`.live-match-row`, que só no BR2026 é um `<button>` `display:flex` (o card inteiro é clicável pra
expandir/colapsar plays+probabilidades, com um chevron ▲/▼ no canto) — a Copa e o CDB2026 não têm
esse wrapper extra, então a mesma estrutura de código funcionou neles mas quebrou só no BR2026.
Corrigido: `.live-match-meta` movida pra fora de `.live-match-row`, como irmã do `row` dentro de
`.live-match` — mesmo padrão da Copa/CDB2026. `NOT_CONSISTENT` → `CONSISTENT`, confirmado com o
jogo real ao vivo via Playwright.

Também investigado no mesmo turno: "onde está o ranking provisório?" — o hero "🏆 Ranking ao
vivo" do BR2026 (`renderLiveRankingHero()`) estava de fato oculto durante esse jogo real, mas por
design, não por bug: só aparecia quando pelo menos um participante já tinha mudado de posição
desde a baseline (`hasMover`), decisão explícita do Eduardo em 2026-07-16 ("se ficar ruim ou
muito busy deixa de fora"). Com Bahia 1×0 aos 21' (1 gol, 1 dos 3 jogos simultâneos), ninguém
tinha cruzado uma fronteira de classificação G4/Z4 ainda — comportamento OK dado o critério
existente, mas gerando a impressão de "sumiu" bem no momento em que mais faz sentido mostrar
algo. Perguntado ao Eduardo antes de reverter a decisão de produto anterior (`AskUserQuestion`) —
confirmado: mostrar sempre que há jogo ao vivo, mesmo sem ninguém se mexendo ainda (setas
neutras "–" em vez da caixa inteira sumir). Implementado em `renderLiveRankingHero()`
(BR2026 v1.65) e propagado ao CDB2026 (v3.48, mesmo padrão de código/decisão, sem tie ao vivo pra
testar agora).

`audit_scoring.py` (BR2026/CDB2026): PASSOU nos dois — mudanças são só layout/CSS e visibilidade
de um componente já existente, nenhuma fórmula de pontuação tocada.

## Nota manual — local do jogo removido do card ao vivo (2026-07-17, Copa v4.146 / BR2026 v1.66 / CDB2026 v3.49)

Eduardo: "Não precisa mostrar a localização no live mode. Ou mostra em outro local logo abaixo dos
times talvez." Interpretado como: remover o local (📍) do card AO VIVO (não do card "próximo
jogo" pré-live, que continua mostrando normalmente) — a alternativa ("logo abaixo dos times") foi
oferecida com "talvez", então a instrução principal (remover) prevaleceu.

- **Copa**: `hero-live-meta` mantém só a fase, local removido.
- **BR2026**: `.live-match-meta` só mostrava local (BR2026 não tem "fase") — bloco removido por
  inteiro do card ao vivo, junto com a extração `comp.venue`/`comp.venue.address.city` em
  `fetchScoreboard()` (só existia pra alimentar essa linha, virou código morto) e a classe CSS
  `.live-match-meta` (sem uso restante no BR2026).
- **CDB2026**: `.live-match-meta` mantém só a fase, local removido.

Local continua aparecendo normalmente no card "Próximo jogo"/"Jogos de hoje"/"Próximos jogos"
(pré-live) nos três apps — só o card AO VIVO deixou de mostrar.

Verificado nos três: Copa (M103 ao vivo simulado com payload real da ESPN), BR2026 (3 jogos reais
ao vivo no momento — Bahia × Chapecoense, Fluminense × Bragantino, Mirassol × Grêmio), CDB2026
(revisão de código, sem tie ao vivo pra testar agora).

`audit_scoring.py` (Copa/BR2026/CDB2026): PASSOU nos três — presentation-only, nenhuma fórmula de
pontuação tocada.

## Nota manual — bug real: Ranking ao vivo mudo no primeiro minuto de qualquer jogo (2026-07-17, BR2026 v1.67)

Eduardo, olhando o "Ranking ao vivo" durante os 3 jogos reais de hoje: "E no ranking também
ninguém mexeu, verifique se isso é correto." Investigado reproduzindo a PÁGINA INTEIRA (não só a
função pura) com dados reais — `calculateRankingMovement()`/`calculateLiveStandings()` chamadas
isoladamente com os mesmos dados davam movimento correto (8 de 11 participantes com seta), mas a
página real, recém carregada, mostrava "–" pra todo mundo. Isolado o bug: em `pollAll()`, o bloco
que atualiza a variável `_standings` com os dados frescos da ESPN rodava DEPOIS do bloco que
decide capturar a baseline de comparação (`captureStandingsBaseline()`, que lê `_standings`, não
os dados recém-buscados) — na primeira vez que um jogo fica ao vivo numa sessão nova, a captura
rodava sobre uma tabela ainda vazia (valor inicial `[]`), falhava silenciosamente, e só se
corrigia no poll seguinte (60s depois).

Corrigido: bloco de atualização de `_standings` movido pra ANTES do bloco de captura de baseline,
mesma ordem lógica em que os dados já deveriam ter sido usados. Verificado com dados reais de
produção nos dois cenários (antes/depois do fix, mesmo timing de um poll único) — confirma o
atraso de 60s eliminado.

Bug é específico do BR2026 (arquitetura própria: baseline de classificação de clube + recálculo ao
vivo em cima dela) — CDB2026 usa `_liveTies` direto, sem esse tipo de baseline em duas etapas, não
tem o mesmo padrão de bug. Não propagado por não se aplicar.

`audit_scoring.py` (BR2026): PASSOU — bug era de timing/ordem de execução, não de fórmula de
pontuação (a conta em si sempre esteve certa).

## Nota manual — cards ao vivo do BR2026 sempre abertos, igual a Copa (2026-07-17, BR2026 v1.68)

Eduardo: "Outra coisa que percebi sumiu os lances: cartoes, gols, substituição." Investigado com
dados reais (3 jogos ao vivo simultâneos) — os lances nunca sumiram, sempre estiveram no HTML.
O que mudava era o recolhimento automático dos cards quando 3+ jogos ficam ao vivo ao mesmo tempo
(decisão antiga do BR2026, de antes desta sessão, para não "poluir a tela" numa rodada cheia —
comentário original: "First time a match id shows up: default expanded when it's just 1-2 games,
collapsed once a full round kicks off together"). A Copa nunca teve esse comportamento — sempre
mostra os lances abertos, independente de quantos jogos estão ao vivo.

Perguntado ao Eduardo antes de reverter (decisão de design antiga, não um bug meu) — confirmado:
sempre aberto, igual à Copa. `NOT_CONSISTENT` → `CONSISTENT`: removida toda a lógica de
expand/collapse do card ao vivo do BR2026 (`_liveExpanded`, `_liveSeenIds`, `defaultExpanded`, o
botão/chevron ▲▼, o listener de clique, a chave i18n `liveToggleExpand`/`liveToggleCollapse`, a
classe CSS `.live-chevron`) — o card agora tem a mesma estrutura da Copa/CDB2026 (sempre mostra
lances + probabilidades, sem toggle).

Verificado com os 3 jogos reais ao vivo de hoje via Playwright — os três cards mostram os lances
sem precisar clicar.

`audit_scoring.py` (BR2026): PASSOU — presentation-only, nenhuma fórmula de pontuação tocada.

## Nota manual — pontuação ao vivo do M103/M104 não incluía bônus de pódio (2026-07-18, Copa v4.147) — CORRIGIDA, achado paralelo no CDB2026 NÃO corrigido

Eduardo, durante o jogo real da disputa do 3º lugar (M103): "O ranking parcial ... não mostra o
bonus pelo 3o lugar. Deveria mostrar assim como amanhã deve mostrar o bonus do primeiro e
segundo. Isso é específico somente desses dois jogos!" Confirmado como bug real (categoria
SCORING, real money) — `liveMatchPoints()`, usada só pela tabela "Pontos (provisório)" do card ao
vivo da Copa, nunca incluía `CONFIG.bonus` (champion/runnerUp/third/fourth), que na pontuação
OFICIAL só é aplicado quando o admin trava o resultado. M103 (3º lugar) e M104 (Final) são as
DUAS únicas partidas cujo vencedor/perdedor decide diretamente um bônus de pódio — as outras
partidas do mata-mata não têm esse bônus associado, por isso "específico só desses dois jogos".

Corrigido (Copa, v4.147): `liveMatchPoints()` agora recebe `matchId` e soma o bônus de pódio
projetado (3º+4º = 15 pts, ou campeão+vice = 40 pts) quando o palpite de avanço da entrada bate
com o lado ganhando ao vivo NESSES DOIS jogos especificamente. Não altera a pontuação oficial
(`scoreEntry()`), só a projeção ao vivo. Verificado com o jogo real (França × Inglaterra) via
Playwright — palpite exato foi de 15 pts pra 30 pts (bônus incluído corretamente).

**Achado paralelo no CDB2026, NÃO corrigido nesta rodada**: `liveScoreEntry()` tem exatamente a
mesma lacuna — a Final do CDB2026 (campeão/vice) também não projeta esse bônus ao vivo. Não
corrigido agora porque: (1) as ties do CDB2026 têm formato ida+volta com classificação agregada
(possivelmente com critério de desempate) — replicar "quem está classificando agora" ao vivo é
mais arriscado de acertar do que o caso da Copa (mata-mata de jogo único); (2) não há nenhuma tie
ao vivo pra testar agora (Oitavas só começa 1º/ago), então não há urgência real. Decisão de
implementar ou não fica pendente de confirmação do Eduardo antes das Oitavas começarem — não é
uma diferença TOURNAMENT_SPECIFIC intencional, é uma lacuna real ainda não corrigida.

BR2026 não tem esse padrão de bug — não usa um "bônus de pódio" separado dos pontos de posição
(G4 exato/Z4 exato JÁ é a pontuação, não uma camada adicional sobre um "avanço correto" como na
Copa/CDB2026), e sua projeção ao vivo (`calculateLiveStandings()`/`currentResultSet()`) já reflete
isso corretamente.

`audit_scoring.py` (Copa): PASSOU — a suíte cobre a pontuação oficial/pipeline de e-mail, não a
exibição ao vivo no navegador (verificado manualmente com dados reais via Playwright).

**Atualização 2026-07-18 (Copa v4.149) — a correção acima (SIDE vs TEAM) tinha o MESMO problema, e a severidade real foi confirmada**: a correção do bônus de pódio ao vivo feita em v4.147 (linhas
acima) comparava apenas o LADO do bracket (`pick.advanceSide === liveAdvance`), não o TIME
realmente previsto pelo próprio bracket da entrada — Eduardo pegou isso ao vivo ainda durante o
M103: "somente quem selecionou a Inglaterra lá no início deve receber o bonus, não o time que
passou." Confirmado com dados reais: de 21 entradas que escolheram o lado B do M103, só 2 (Simone
Hirle #4, Gabriel Ferrari) tinham de fato rastreado "Inglaterra" pelo próprio bracket — as outras
19 previram times completamente diferentes (México, Argentina, Colômbia, Brasil, Suíça...) que só
coincidiram no mesmo lado. Corrigido em v4.149 comparando o time resolvido pelo próprio bracket da
entrada (`resolvedTeamsForEntry()`) contra o time real que está liderando (`officialWinnersMap()`),
mesma lógica que `scoreEntry()`/`finalPodiumForEntry()` já usava corretamente. **Importante**: essa
falha era exclusiva do preview ao vivo no navegador — a pontuação OFICIAL (`scoreEntry()`),
`send_result_email.py` e o prêmio em dinheiro (v4.148) sempre compararam por nome do time, nunca
por lado, e nunca estiveram errados; nenhum participante foi pago ou pontuado incorretamente.

Isso eleva a prioridade do achado paralelo no CDB2026 registrado logo acima (`liveScoreEntry()` com
a mesma lacuna de bônus de pódio ao vivo) — se o CDB2026 replicar esse padrão de comparação por
lado quando for implementado/testado, o mesmo bug (super-contagem massiva do bônus ao vivo) deve se
repetir. Ainda não corrigido no CDB2026 nesta rodada (mesma decisão de adiar já registrada acima —
sem tie ao vivo pra testar até 1º/ago), mas ao revisitar antes das Oitavas, tratar como prioridade
alta, não apenas um "nice to have".

## Nota manual — prêmio em dinheiro do pódio: banner + email (2026-07-18, Copa v4.148) — COPA APENAS, feature nova sem equivalente em BR2026/CDB2026

Eduardo, com a Final marcada pro dia seguinte: pediu um email especial para campeão/vice/3º lugar
com o valor recebido, e uma tela especial no site após o fim da Final mostrando o valor pago para
cada um + agradecimento pela participação. Investigação prévia confirmou que `CONFIG.prizes`
(70/20/10%) existia em `config.js` desde antes desta sessão mas nunca era usado em lugar nenhum —
não havia cálculo de prêmio em dinheiro implementado, nem no site nem nos dois caminhos de email.

Implementado só na Copa (`bolao/`): `finalPodiumPayouts()` (JS, site) / `compute_final_payouts()`
(Python, email automático) / `buildPodiumEmailHtml()` (JS, email manual do admin) — as três
espelham exatamente a mesma lógica (ranking geral por total→exato→pódio, agrupamento de empate
real via chave `total:exato:pódio`, divisão do valor da colocação entre empatados, conforme regra
já documentada na aba Regras mas nunca codificada). Só ativa quando M103 E M104 estão travados
pelo admin. Verificado com dados reais de produção (23 entradas pagas, pote $115): os três
caminhos (banner do site, email automático, email manual) produzem exatamente os mesmos valores
($80.50/$23/$11.50).

**Por que não propagado para BR2026/CDB2026 nesta rodada**: este é um conceito de "pódio do BOLÃO"
(top-3 participantes por pontos, prêmio em dinheiro) — diferente do "pódio do TORNEIO" (que
seleção fica campeã) que já existe nos três apps para o bônus de pontos. BR2026 não tem uma
condição de "torneio decidido" única e discreta como M103+M104 da Copa (o Brasileirão termina numa
rodada só, sem partida final dedicada) — precisaria de um trigger de fim de temporada próprio, não
uma cópia direta. CDB2026 tem uma Final única (like Copa) e é o candidato mais próximo para portar
esta feature, mas isso não foi pedido nesta rodada e fica registrado como trabalho futuro, não como
lacuna esquecida — ver `ROADMAP.md`.

`audit_scoring.py`: PASSOU nos três apps (Copa, BR2026, CDB2026) sem alteração — feature nova é
puramente aditiva (cálculo de prêmio em dinheiro), não toca pontuação nem regra de negócio.

## Nota manual — relatório de auditoria trilíngue publicado no site (2026-07-18, Copa v4.150) — COPA APENAS

Eduardo, na véspera da Final: pediu uma auditoria automática com relatório estilo "big 4", nas 3
línguas, com o máximo de detalhes, publicada no site com link antes do resultado final ser
conhecido — um gesto de transparência antes do dinheiro ser distribuído amanhã.

Implementado só na Copa: `bolao/scripts/generate_audit_report.py` gera `bolao/audit-report.html`
a partir de dados reais de produção — recalcula a pontuação de TODAS as entradas reais de forma
independente (código separado do `score_entry_total()` oficial), verifica integridade de dados,
fórmula de pontuação, mecanismo de prêmio, critérios de desempate, e divulga com transparência os
dois bugs achados e corrigidos hoje (v4.147, v4.149). Link discreto adicionado no topo da aba
Ranking. Não usa nome/marca de nenhuma empresa de auditoria real — o relatório deixa isso explícito
no cabeçalho, "big 4 style" aqui significa a estrutura/rigor do documento, não a marca.

**Por que não propagado para BR2026/CDB2026 nesta rodada**: pedido explicitamente no contexto da
Final da Copa de amanhã — nenhum dos outros dois apps tem uma partida decisiva iminente agora.
O script (`generate_audit_report.py`) foi escrito de forma específica para o bracket/scoring da
Copa (`MATCH_TEAMS`, `SCORING`, `BONUS`, `PRIZES` de `send_result_email.py`) — portar exigiria
reescrever a lógica de recálculo independente para a fórmula de cada app (G4/Z4/SA6 no BR2026;
pontos por partida + bônus de confronto/pódio no CDB2026), não uma cópia direta. Registrado como
trabalho futuro em `ROADMAP.md`, não como lacuna esquecida.

`audit_scoring.py`: PASSOU nos três apps (Copa, BR2026, CDB2026) sem alteração — o script novo é
somente leitura (gera um relatório HTML estático), não toca pontuação nem regra de negócio em
nenhum app.

## Nota manual — bônus do 3º lugar zerado até a Final também estar decidida (2026-07-19, Copa v4.151) — este SIM afetava a pontuação OFICIAL

Eduardo, logo após o M103 concluir e o e-mail automático ser enviado: "O email pos jogo foi
enviado sem o bonus do 3 lugar por que." Diferente dos dois achados anteriores (v4.147, v4.149,
ambos confinados à prévia ao vivo no navegador), este afetava `scoreEntry()`/`score_entry_total()`
diretamente — `_podium_from_results()`/`podiumFromResults()` só retornavam um resultado quando
M103 **e** M104 estavam AMBOS decididos, mesmo M103 já estando totalmente resolvido (Inglaterra
3º lugar). Isso zerou o bônus de 3º/4º lugar de todo mundo, incluindo as 2 entradas reais que
realmente previram a Inglaterra (Simone Hirle #4, Gabriel Ferrari) — cada uma perdendo 10 pts no
ranking do site e no e-mail já enviado. Corrigido para que campeão/vice (M104) e 3º/4º lugar
(M103) sejam calculados de forma independente. Ranking do site já correto automaticamente
(recalculado a cada carregamento, nunca armazenado); e-mail já enviado permanece com o valor
antigo — próximo e-mail (pós-Final) já sai correto. Adicionado teste de regressão permanente em
`audit_scoring.py` (`check_partial_podium_bonus`) que trava só até M103 e confere que o bônus
ainda se aplica — confirmado que falha contra a lógica antiga e passa com a correção.

**Verificado nos outros dois apps — não aplicável a nenhum**: CDB2026 tem campeão+vice vindos de
uma única partida Final (sem uma partida separada de 3º lugar decidindo parte do pódio de forma
independente, como o M103/M104 da Copa) — não há um "gate" equivalente para quebrar dessa forma.
BR2026 não tem conceito de bônus de pódio. Nenhuma ação necessária nos outros apps.

## Nota manual — bônus de pódio nunca aparecia na quebra por partida, só no total (2026-07-19, Copa v4.152) — gap de exibição, não de cálculo

Eduardo, logo após o e-mail de correção do v4.151: "Email foi mais uma vez incorreto sem o bonus."
Investigado antes de qualquer alteração: confirmado que o site JÁ EM PRODUÇÃO (`app.js?v=e06ccef`)
já tinha a correção do v4.151 — `score_entry_total()`/`scoreEntry()` retornavam 227/158
corretamente para Simone Hirle #4/Gabriel Ferrari, verificado direto contra dados reais antes de
tocar em qualquer código.

Causa real: a tabela de quebra por partida do M103 — presente em TRÊS lugares (e-mail automático,
e-mail manual do admin, painel "Ver palpites" do site) — sempre mostrou só os pontos base
(exato/gols/avanço, no máximo 15), nunca o bônus de pódio, mesmo o TOTAL agregado (tabela de
ranking, badge de bônus) sempre tendo incluído corretamente. Alguém lendo "M103: 5 pts, +5
England avança" (o primeiro número que aparece no e-mail) razoavelmente concluiria que o bônus
ainda estava faltando, sem necessariamente conectar isso ao total correto várias linhas abaixo.
Essa mesma lacuna existia de forma independente nos três lugares — muito provavelmente a causa
real dos três relatos de "sem o bônus", não uma repetição do bug de cálculo do v4.151.

Corrigido dobrando o bônus de pódio nos pontos EXIBIDOS por partida para M103/M104 especificamente
(mesmo padrão já usado pela prévia ao vivo, `liveMatchPoints()`), com nota explícita onde há coluna
de detalhe, e tooltip no "Ver palpites" (que não tem coluna de detalhe). Não toca a lógica do total
agregado (`scoreEntry()`/`score_entry_total()`), que já estava correta e continua sendo a fonte da
verdade — só torna a exibição por partida consistente com o que o total já dizia.

`audit_scoring.py`: PASSOU, sem alteração — fix é de exibição apenas.

## Nota manual — probabilidade de ganhar o bolão + auditoria completa de rastreabilidade (2026-07-19, Copa v4.153) — COPA APENAS

Eduardo pediu: (1) atualizar a aba Probabilidades para mostrar a chance de cada entrada ganhar o
bolão (não só as odds do time no Mundial), e (2) uma auditoria completa "de nível de auditoria de
loteria" — cada resultado de cada jogo no palpite de cada pessoa, com data/hora de criação e
modificação de cada entrada, estruturada como resumo executivo + links para detalhe (inclusive
código), não uma página só gigante.

**Aba Probabilidades**: nova seção "💰 Chance de ganhar o bolão" (`computeMoneyProbabilities()`) —
reutiliza `finalPodiumPayouts()` (já validado) contra dois placares mínimos (1-0/0-1) para as duas
equipes que restam na Final, ponderado pelas odds ao vivo do Polymarket entre essas duas equipes
especificamente. Só aparece quando M103 está decidido e M104 ainda não — desaparece sozinho quando
a Final terminar de verdade (o banner de pódio já existente assume nesse momento).

**Auditoria de rastreabilidade**: `audit-report.html` virou um resumo executivo de verdade (texto
condensado + seção de links), com duas páginas novas: `audit-detail-picks.html` (palpite, resultado
real e pontos de cada uma das 32 partidas, para cada uma das 23 entradas reais, com índice
navegável) e `audit-detail-governance.html` (criação/última atualização de cada entrada + histórico
completo de edições já capturado pelo `auditLog` do site — antes/depois de cada palpite alterado,
IP mascarado, dispositivo, horário). Achado divulgado com transparência: 11 das 23 entradas têm
`updatedAt` diferente de `createdAt` SEM um registro correspondente no `auditLog` — não é uma edição
real (o fluxo "editar por código" sempre grava um registro), provavelmente uma operação
administrativa/migração anterior a esta auditoria, causa exata não estabelecida. E-mails de
participantes não aparecem em nenhuma página pública de auditoria (mesma política do resto do
site). Ambas as páginas novas: trilíngues no cabeçalho/estrutura, mas com notas por linha só em
português (limitação de escala reconhecida — 736 linhas de dado bruto — números/nomes de times/
horários já são iguais em qualquer idioma).

**Por que não propagado para BR2026/CDB2026 nesta rodada**: mesma razão do v4.150/v4.151 — pedido
no contexto específico da Final da Copa de amanhã, e a lógica de recálculo (`compute_final_payouts`
equivalente, `MATCH_TEAMS`) é específica do bracket da Copa. Registrado como trabalho futuro em
`ROADMAP.md` (mesma entrada M-06, ampliada).

`audit_scoring.py`: PASSOU nos três apps, sem alteração — ambas as adições são somente leitura.

## Nota manual — correção de semântica "avança", IP completo na auditoria, geração real da Classificação Geral (2026-07-19, Copa v4.154) — COPA APENAS

Eduardo pediu, revisando o site antes da Final: (1) a página que ele queria dizer com
"probabilidades" era `classificacao-geral.html` (não a aba Probabilidades do v4.153) — pediu
atualização com o mesmo rigor de auditoria; (2) IP completo (não mascarado) na página de governança
de auditoria; (3) "+5 {time} avança" está semanticamente errado nos jogos M103 (3º lugar) e M104
(Final) — "questão apenas de semântica", pontuação inalterada; (4) varredura completa confirmando
que os 15 pontos do Gabriel Ferrari no M103 já incluem o bônus de 10 do 3º lugar, sem duplicação.

**Reversão de política — IP não mais mascarado em `audit-detail-governance.html`**: no v4.153, IP
era mostrado com o último octeto mascarado (`xxx`) como precaução de privacidade. Eduardo pediu
explicitamente IP completo desta vez — `_mask_ip()` removida do `generate_audit_report.py`, texto
descritivo da página atualizado. E-mails de participantes continuam fora (política inalterada).
Isso é uma decisão explícita do dono do produto que substitui a decisão de privacidade anterior —
registrado aqui porque reverte algo já documentado, não porque é dúvida em aberto.

**"avança" → wording correto por partida**: `score_match()` (Python) e `scoreMatchSingle()` (JS)
agora recebem o `mid` da partida; M103 mostra "vence a disputa de 3º lugar"/"wins the 3rd place
match", M104 mostra "vence a Final"/"wins the Final", as demais partidas mantêm "avança"/"advances"
sem alteração. Pontuação (+5) idêntica nos três casos — verificado com dado real (M103: France 4×6
England) em Python e Node.

**Gabriel Ferrari (15 pontos, M103) — confirmado correto, não é bug**: varredura das 23 entradas
reais somando cada um dos 32 pontos por partida exibidos (já com bônus de pódio embutido, regra do
v4.152) contra `score_entry_total()` — zero divergências. 15 = 5 (acerto de lado) + 10 (bônus 3º
lugar), embutido uma única vez.

**`classificacao-geral.html` — primeira geração real, com script novo** (`generate_classificacao_geral.py`):
a página existia desde v4.134 (15/07) sem nenhum gerador, escrita à mão uma vez, com dados só até
as semifinais. Agora regenerada a partir do estado real do Supabase, reusando as mesmas funções de
pontuação/desempate de `send_result_email.py` (nunca pode divergir da pontuação oficial). Como só
falta o M104, a checagem Vivo/Eliminado virou uma enumeração exata (56 cenários — todo placar
0×0–6×6, empate contando os dois lados de pênaltis), e as porcentagens de chance usam um modelo
Poisson bivariado calibrado pelas odds ao vivo do Polymarket para os dois finalistas (modelo novo e
divulgado na própria página — o motor de Monte Carlo do `app.js` é só-JS e não é portável para
Python). Bug pego e corrigido antes de publicar: a primeira versão ordenava as linhas só pelo total
de pontos, o que colocava empates na ordem visual errada quando o desempate (placares exatos/pódio)
importava — corrigido para ordenar pela posição já calculada com desempate; reverificado com dado
real (Gabriel Ferrari vs. Marodin, Gustavo Ribeiro vs. Simone Hirle #2).

**Por que não propagado para BR2026/CDB2026**: mesma razão das notas anteriores desta seção —
pedido no contexto específico da Final da Copa de hoje, e a lógica de recálculo/bracket é específica
da Copa. Registrado como trabalho futuro em `ROADMAP.md` (mesma entrada M-06).

`audit_scoring.py`: PASSOU nos três apps, sem alteração — mudanças de wording, exibição de IP e um
novo gerador de relatório somente-leitura; nenhuma fórmula de pontuação, bracket ou regra de negócio
foi alterada.

## Nota manual — CDB2026 publicado (2026-07-19) — decisão de plataforma, não Copa apenas

Eduardo pediu para convidar todos os participantes para o bolão da Copa do Brasil por e-mail, "já
que o BR2026 já fechou" (entradas do BR2026 fechadas desde `cutoffIso` 2026-07-16). Confirmado
explicitamente com Eduardo antes de agir: CDB2026 está pronto para abrir de verdade hoje (não é
um teste) — Supabase habilitado (`stateId: cdb2026`), EmailJS configurado, métodos de pagamento
reais, 3 entradas reais já existentes (anonimizadas aqui: Participante A, Participante B,
Participante C), fase
5 (oitavas de final atual, nomeada `fase-5` no estado) já com resultados reais via sync ESPN, e a
próxima fase (`oitavas`, Rodada de 16) com jogos reais agendados a partir de 01/08/2026 — ou seja,
cutoff real ainda no futuro, não uma corrida contra um prazo já vencido.

**O que mudou com a publicação**: só a documentação (`CLAUDE.md`, `PROJECT_MEMORY.md`,
`PLATFORM_GOVERNANCE.md`, `PROJECT_CONTEXT.md`) — removida a marcação "não publicado" para
CDB2026. Nenhum código do app mudou (CDB2026 já estava tecnicamente acessível via
`bolao-switcher` desde que foi construído; "publicar" aqui significa apenas ser oficialmente
anunciado/divulgado aos participantes, não uma mudança técnica). Não foi adicionado link no site
pessoal principal (`ferrarilabs.github.io/index.html`) — divulgação é só pelo e-mail/grupo de
participantes, mesma forma como o Copa do Mundo e o BR2026 já circulam.

**BR2026 não afetado por esta mudança** — continua "não publicado" no `CLAUDE.md`, entradas
fechadas, nenhuma alteração de status ou de link solicitada ou feita para ele nesta rodada.

Classificado como decisão de plataforma (não `TOURNAMENT_SPECIFIC`) porque altera o status de
publicação de um app inteiro, não uma regra de torneio — por isso registrado aqui, além do
changelog do próprio CDB2026.

## Nota manual — auditoria de propagação do v4.154 para BR2026/CDB2026 (2026-07-19)

Eduardo pediu, explicitamente, para confirmar que os fixes do v4.154 (e os fixes de pódio de
v4.151/v4.152) também foram aplicados ao BR2026 e ao CDB2026 — "very important and should be
thoroughly done". Auditoria feita lendo o código real dos dois apps (não assumida), item por item:

**1. Wording "avança" (v4.154)** — grep em `bolao/br2026/js/`, `bolao/br2026/scripts/`,
`bolao/cdb2026/js/`, `bolao/cdb2026/scripts/` não encontra a string em nenhum contexto de
pontuação/e-mail (os únicos 2 hits são comentários de código sobre `rank` avançar de posição, sem
relação). **CDB2026 nunca teve esse bug**: `matchPoints()`/`scoreEntry()` retornam só
`{pts, type}` sem texto livre — a UI já usa `"quem se classifica"` (`i18n.js:40-41,113,167`) em vez
de "avança", desde que o app foi reescrito (v3.x). **BR2026 não tem conceito de chaveamento/avanço
nenhum** (é pick de classificação G4/Z4 de liga, não mata-mata) — não há "quem avança" pra
nomear certo ou errado. Nada a propagar.

**2. IP completo na auditoria de governança (v4.154)** — a captura de IP
(`fetch("https://api.ipify.org?...")`, `bolao/js/app.js:3128`) e o fluxo de auto-edição do
participante (`editByCodeCard`) só existem na Copa. Confirmado via grep: nenhuma das duas
strings aparece em `bolao/br2026/js/app.js` nem `bolao/cdb2026/js/app.js` fora de UM comentário
no BR2026 (linha 2905) que só *referencia* o padrão da Copa por nome, sem implementá-lo — o que
existe no BR2026/CDB2026 é edição pelo ADMIN (`_editingEntry`), sem captura de IP/dispositivo.
Nenhum dos dois apps tem um gerador de relatório de auditoria (`generate_audit_report.py`
equivalente) nem uma página `audit-detail-governance.html` equivalente. Não há IP nenhum
mascarado ou desmascarado para propagar — a feature simplesmente não existe fora da Copa.

**3. `classificacao-geral.html` (v4.154)** — página standalone específica da Copa (histórico
de ter existido sem gerador desde v4.134). BR2026 e CDB2026 não precisam de uma página
equivalente porque já têm a mesma informação **dentro do próprio app**: BR2026 tem "Projeção do
Bolão" (Fases 2-9, já implementado), CDB2026 tem a aba "Probabilidades". Arquitetura
intencionalmente diferente, não uma lacuna — ver `BR2026_PROJECTION_MODEL.md`.

**4. Bug de pódio retido até TODAS as partidas decididas (v4.151)** — verificado
estruturalmente: `officialPodium(s)` no CDB2026 (`bolao/cdb2026/js/app.js:422-430`) deriva
campeão E vice do MESMO `qualifiedTeamId` de uma única partida Final (CDB2026 não tem disputa de
3º lugar, por regra do próprio torneio — `scoring.bonus` só tem `champion`/`runnerUp`). Não existe
uma segunda partida separada (equivalente ao M103 da Copa) cujo resultado poderia gatear os dois
bônus artificialmente — o bug do v4.151 dependia estruturalmente de DUAS partidas separadas
alimentando o mesmo pódio, o que não existe no modelo do CDB2026. BR2026 não tem bônus de pódio
(sem `champion`/`bonus` em `bolao/br2026/js/config.js`) — nada a checar.

**5. Bônus de pódio não itemizado no detalhamento por partida (v4.152)** — verificado com o
código real: `bonusRow()` em `bolao/cdb2026/js/app.js:1080-1087` já renderiza `detail.champion` e
`detail.runnerUp` como LINHAS PRÓPRIAS na tabela "Ver palpites"/comprovante, com os pontos
(`ptsCell(d)`) mostrados separadamente de cada partida — nunca teve o gap do v4.152 (onde o total
agregado estava certo mas o detalhamento por partida omitia o bônus). BR2026 não tem bônus de
pódio, nada a itemizar.

**Conclusão**: os 5 fixes auditados não têm equivalente no BR2026/CDB2026 porque os bugs
dependiam de estruturas específicas da Copa (chaveamento com 3º lugar + Final como duas partidas
separadas, wording "avança" herdado do chaveamento, e uma feature de auto-edição com IP que só a
Copa tem). Isso está de acordo com `PLATFORM_GOVERNANCE.md` — "diferenças específicas de torneio
(scoring, bracket, regras) devem ser preservadas — não generalizar entre apps." Nenhuma alteração
de código foi feita no BR2026 ou CDB2026 como resultado desta auditoria porque nenhuma foi
necessária; `audit_scoring.py` continua passando nos três apps sem alteração.

## Nota manual — bug real propagado nos três apps: substituições sumidas dos lances ao vivo (2026-07-19, Copa v4.156 / BR2026 v1.69 / CDB2026 v3.50)

Ao contrário da nota anterior (nenhuma propagação necessária), este achado É um `PLATFORM_SHARED`
real: `extractMatchPlays()` foi copiado (porta direta) da Copa para o BR2026 e o CDB2026 quando o
recurso de lances ao vivo foi construído — mesmo bug nos três, porque os três liam só
`comp.details` do endpoint de scoreboard da ESPN, que nunca inclui substituições (confirmado ao
vivo, Final da Copa do Mundo, 79º minuto, 11 substituições reais, zero apareceram em
`comp.details`, só os 2 cartões amarelos).

Corrigido nos três no mesmo dia: `fetchEspnEventSummary(eventId)` busca o endpoint de summary por
evento da ESPN (`keyEvents`, inclui substituições), só para partidas ao vivo no momento (sem custo
extra em polls normais), com fallback para `comp.details` se a busca falhar. Mesma função,
adaptada à URL/liga de cada app (`fifa.world` na Copa, `bra.1` no BR2026, `bra.copa_do_brazil` no
CDB2026) e ao ponto de chamada de cada um (`pollLiveScores()`/`fetchScoreboard()`/
`fetchEspnCandidates()`). Verificado com dado real da ESPN para as três ligas antes de shippar.

`audit_scoring.py`: PASSOU nos três apps, sem alteração — mudança de apresentação apenas.

## Nota manual — modo arquivo da Copa (2026-07-19, Copa v4.157) — COPA APENAS, template pra quando BR2026/CDB2026 encerrarem

Copa do Mundo 2026 encerrada (Espanha campeã). Eduardo: "Desabilitar os botões todos, deixar só o
vencedor, auditoria e os palpites." Novo `CONFIG.archived` (`bolao/js/config.js`) — flag única,
reversível — esconde os botões de nav Palpites/Jogos/Probabilidades/Regras/Admin e trava a aba
Ranking como única seção alcançável (`applyArchiveMode()` em `app.js`). Nenhuma página nova: o
Ranking já reunia pódio/vencedor, link de auditoria e "Ver palpites" por entrada — só precisava
tirar o ruído de navegação ao redor. Admin continua acessível (nunca foi removido, só escondido do
header) via link discreto no rodapé — a proteção de verdade sempre foi o `guardAdmin()` com senha.

Também decidido nesta conversa: **não mover** `bolao/` para `bolao/copa2026/` — a URL atual está
espalhada em e-mails reais já enviados, no relatório de auditoria e no switcher dos outros dois
apps; mover quebraria tudo isso sem necessidade. `bolao/` fica congelado como o arquivo permanente
da Copa 2026; a Copa 2030 (daqui a 4 anos) vira uma pasta nova irmã (`bolao/copa2030/`), mesmo
padrão do BR2026/CDB2026, quando chegar a hora.

**Por que não propagado**: BR2026 e CDB2026 ainda estão em andamento (BR2026 com entradas
fechadas mas temporada rolando; CDB2026 recém-publicado, oitavas começam 01/08/2026). Modo
arquivo não faz sentido até cada torneio de fato terminar. Esta nota serve de referência/template
para quando chegar a vez de cada um — mesmo flag `archived`, mesma função `applyArchiveMode()`,
adaptada à estrutura de nav de cada app.

`audit_scoring.py`: PASSOU, sem alteração — mudança de navegação apenas.

## Nota manual — Copa movida para bolao/copa2026/, /bolao/ agora redireciona para o Brasileirão (2026-07-19, Copa v4.159 / BR2026 v1.70 / CDB2026 v3.51)

Eduardo, depois do v4.158 (que só trocava a opção padrão do seletor): "O drop down aparece mas a
pagina não redireciona" — esperava um redirect de verdade. Confirmado o plano completo antes de
mexer: mover o app inteiro da Copa (era direto em `bolao/`) para `bolao/copa2026/`, igual ao
padrão já usado por `bolao/br2026/`/`bolao/cdb2026/`, para que `bolao/index.html` pudesse virar um
redirect real sem deixar o Ranking arquivado (pódio/auditoria/"Ver palpites", v4.157) sem
nenhuma URL própria.

**O que mudou**: `bolao/index.html`, `js/`, `css/`, `assets/`, `scripts/`, `docs/`, `preview/`,
`audit-report.html`, `audit-detail-picks.html`, `audit-detail-governance.html`,
`classificacao-geral.html`, `CHANGELOG.md`, `README.md`/`README.txt` moveram (via `git mv`,
histórico preservado) para `bolao/copa2026/`. `bolao/index.html` agora é um redirect (meta
refresh + `location.replace`) para `/bolao/br2026/`. Os 4 links já enviados por e-mail a
participantes reais (`audit-report.html` e os 3 outros) ganharam stubs de redirect próprios em
`bolao/` apontando para `bolao/copa2026/...` — nada que já foi enviado quebra. `bolao/sw.js` foi
mantido (cópia idêntica, inalterada) no caminho antigo como rede de segurança para qualquer
navegador que ainda tenha o service worker antigo (escopo `/bolao/`) registrado.

Referências absolutas corrigidas: canonical link, opção "Copa do Mundo" do seletor (nos 3 apps —
apontar pra `/bolao/` criaria loop infinito agora), array `allowed` do handler do seletor (nos 3
apps), registro do service worker, links de rodapé nos e-mails (`send_result_email.py`,
`send_bracket_correction_email.py`), e os links de código-fonte no relatório de auditoria
(`generate_audit_report.py`) — `REPO_ROOT`/`OUT_PATH` dos dois scripts geradores
(`generate_audit_report.py`, `generate_classificacao_geral.py`) ganharam um nível extra de
`os.path.join(..., "..")` pela pasta nova. Relatórios de auditoria regenerados com os scripts já
corrigidos para confirmar.

**Verificação**: `node --check` nos 3 apps, `python3 -m py_compile` nos scripts da Copa,
`audit_scoring.py` PASSOU nos 3 apps (rodado a partir do novo caminho pra Copa). Cadeia de
redirect testada de ponta a ponta com Playwright (`/bolao/` → `/bolao/br2026/`,
`/bolao/audit-report.html` → `/bolao/copa2026/audit-report.html`, idem para os outros 3 stubs) —
todos confirmados funcionando. A verificação visual completa da página movida
(`bolao/copa2026/`) via Playwright ficou limitada por uma instabilidade de rede do sandbox
(scripts síncronos do CDN — emailjs/supabase-js — travando o carregamento no navegador headless;
confirmado que não é regressão do code, já que o BR2026, intocado nesse aspecto, apresentou o
mesmo travamento no mesmo teste) — a inspeção direta do HTML gerado confirma que os valores estão
corretos, e a lógica de nav/switcher em si não foi alterada nesta mudança (só os valores/paths).
Recomenda-se uma checagem visual manual rápida em produção depois do deploy.

`audit_scoring.py`: PASSOU nos 3 apps, sem alteração — mudança estrutural/de caminho apenas,
nenhuma fórmula de pontuação, bracket ou regra de negócio tocada.

## Nota manual — GitHub Actions quebrado pela mudança da Copa, gap real na auditoria pós-move (2026-07-22)

Eduardo: "I got a workflow error about email send." A auditoria pós-move (2026-07-19) cobriu HTML,
JS, Python e docs, mas **não verificou `.github/workflows/`** — gap real. `auto_results.yml` tinha
duas etapas com `working-directory: bolao/scripts` (não existe mais desde o v4.159) e um
`git add bolao/js/config.js`; `sync_version.yml` (bot de cache-bust) tinha o path de trigger
observando `bolao/js/**`/`bolao/css/**` (não existe mais) e nunca incluía
`bolao/copa2026/index.html` no loop de sync. Confirmado via log real do run que falhou (GitHub
Actions run 29883861333) antes de mexer em qualquer coisa.

Corrigido: os dois `working-directory`, o `git add`, o path de trigger, e o loop de sync — todos
agora apontam para `bolao/copa2026/`. Verificado que `send_result_email.py --auto` já é idempotente
(só age em match IDs ainda não salvos no Supabase — como M104 já está travado, o restante das
execuções agendadas este mês só vão reportar "nada a fazer" e sair, sem risco de e-mail
duplicado) antes de considerar a correção de caminho suficiente por si só.

**Follow-up (mesmo dia, 2026-07-22):** Eduardo, ao ver o fix do workflow: "You should have been
through everywhere" — correto, o grep original da auditoria de 2026-07-19 rodou dentro de
`bolao/` e não cobriu o resto do repositório. Varredura completa no repo inteiro (`grep -rn
"bolao/"` excluindo `.git` e os três diretórios de app) encontrou mais gaps reais, todos
corrigidos nesta rodada:

- **Security-relevant, o mais sério dos achados:** `.gitignore` só tinha `bolao/backups/`.
  `backup.py`/`backup_daily.py` resolvem `BACKUP_DIR` relativo à própria localização do script
  (`Path(__file__).parent / "backups"`) — depois do move do v4.159, isso passou a resolver para
  `bolao/copa2026/backups/`, que o `.gitignore` **não cobre mais**. Esses backups contêm dados
  reais de participante (nome, e-mail, método de pagamento) vindos do Supabase. Confirmado via
  `git log --all --diff-filter=A -- "*backups*"` que nenhum arquivo de backup chegou a ser
  commitado (nenhum vazamento real ocorreu — não há workflow de CI que rode backup e commite o
  resultado), mas o gap era real e permanente até este fix. Corrigido adicionando
  `bolao/copa2026/backups/`, `bolao/br2026/backups/` e `bolao/cdb2026/backups/` ao `.gitignore`
  (mantendo a entrada antiga `bolao/backups/` por segurança).
- `CHATGPT.md` (raiz do repo) — muito mais desatualizado que o próprio move: ainda descrevia um
  único app em `bolao/` (pré-BR2026/CDB2026), datado de 2026-06-27. Reescrito como um ponteiro
  compacto para `CLAUDE.md` (que é mantido a cada sessão) em vez de duplicar conteúdo — a
  duplicação foi a causa raiz do drift, não só o move.
- Referências de path desatualizadas em seis docs operacionais que instruem sessões futuras a
  rodar comandos — `QA_CHECKLIST.md`, `QA_MASTER_CHECKLIST.md`, `UI_REGRESSION_PROTOCOL.md`,
  `CDB2026_RULES_AND_MODEL.md`, `PROJECT_MEMORY.md`, `ARCHITECTURE.md`, `LESSONS_LEARNED.md`
  (`bolao/scripts/audit_scoring.py` → `bolao/copa2026/scripts/audit_scoring.py`, etc.). Essas
  eram instruções acionáveis (não registro histórico) — deixadas erradas, uma sessão futura
  seguindo o checklist ao pé da letra rodaria um comando inexistente.
- `PROJECT_MEMORY.md` também tinha uma afirmação factual que ficou errada com o move: dizia que
  os três apps registram o mesmo `/bolao/sw.js`. Depois do v4.159 a Copa passou a registrar sua
  própria cópia em `/bolao/copa2026/sw.js`; BR2026/CDB2026 continuam no `/bolao/sw.js`
  compartilhado. Corrigido para descrever o estado real.
- **Deixado como está, intencionalmente:** entradas de changelog e docs datados (`docs/bolao/CHANGELOG.md`,
  `BR2026_LIVE_STANDINGS.md`, e as entradas históricas de `CONSISTENCY_MATRIX.md` acima desta
  nota) que citam `bolao/js/...` — são registro histórico de um estado real na data em que foram
  escritas, reescrever isso seria revisionismo, não correção.

Lição adicional: "auditar tudo" depois de mover uma pasta não pode significar "grep dentro da
pasta nova" — precisa incluir todo o repositório, porque referências ao path antigo sobrevivem
em lugares que não são intuitivamente "sobre" o app (workflows do CI, `.gitignore`, docs de AI
assistant na raiz do repo, docs de processo/checklist).

**Lição para a próxima vez que um app mover de pasta**: adicionar `.github/workflows/*.yml` à
lista de lugares a auditar por padrão — não é intuitivo que workflows de CI fiquem fora do
grep normal de "bolao/" porque vivem em `.github/`, fora da árvore `bolao/`.

`audit_scoring.py`: PASSOU nos 3 apps, sem alteração — configuração de CI apenas.

## Nota manual — assunto de e-mail com "&#x2F;" literal em vez de "/" (2026-07-24, PLATFORM_SHARED)

Eduardo enviou screenshots do e-mail de rodada do BR2026 mostrando o assunto
`Rodada 16&#x2F;07–23&#x2F;07 — resultados e classificação` em vez de `Rodada 16/07–23/07 — ...`.

**Causa raiz**: `send_round_email.py` (BR2026) reaproveita o template de comprovante padrão do
EmailJS (`template_xq7yzzb`, compartilhado com Copa/CDB2026), colocando o texto do assunto nos
campos `entry_name`/`receipt_code` (não existe campo "subject" dedicado no payload do EmailJS).
O **corpo** desse template já usa `{{{html_message}}}` (chave tripla = sem escape) conforme regra
já documentada no `CLAUDE.md`. Mas o campo **Subject** do template, configurado no dashboard do
EmailJS (fora deste repositório), ainda referencia esses campos com `{{}}` simples — que faz
escape de HTML, transformando "/" em "&#x2F;". Isso sempre foi verdade desse template, só nunca
apareceu antes: nomes de entrada normais nunca continham "/". A funcionalidade de e-mail de
rodada do BR2026 (2026-07-16) foi a primeira coisa a colocar uma string com "/" (um intervalo de
datas) nesse campo.

**Fix 1 (mesmo dia)**: corrigido em código em vez de exigir edição no dashboard do EmailJS —
`_fmt_date_range_subject()` em `send_round_email.py`, formata com "." em vez de "/" só nas três
linhas de assunto (participante, resumo admin, `--test-send`). Corpo HTML mantém "/" via
`_fmt_date_range()` original — não afetado, passa por `{{{html_message}}}`.

**Follow-up (mesmo dia)**: Eduardo perguntou "Fixed for everything that exists now and the
future?" — o fix acima cobria só as datas. Investigação adicional achou a mesma classe de bug
com outra fonte viva: os e-mails normais de confirmação de entrada (Copa, BR2026, CDB2026 — os
três) colocam o nome da entrada, digitado livremente pelo participante, direto no campo
`entry_name`. Se algum participante já tiver digitado "/" no nome da entrada (ex.: "João/Maria"),
o assunto do comprovante — e a cópia enviada ao admin — teriam o mesmo problema. Pré-existente
nos três apps, não relacionado à mudança de pasta da Copa, baixa probabilidade mas real.

Corrigido nos três apps (autorizado por Eduardo via pergunta direta): `emailSubjectSafe(s)`
(troca "/" por "-") adicionada ao lado de `receiptCode()` em cada `app.js`, aplicada em todo
lugar onde uma string digitada pelo participante alimenta `entry_name` — confirmação inicial +
cópia ao admin, e-mail de remoção, assunto do e-mail de resultado (defensivo — nomes de time são
dado controlado, não input de usuário, mas barato de cobrir), e-mail de confirmação de edição.
`receiptCode()` não precisou de alteração (hash hex + dígitos, sem risco). Detalhe completo em
`bolao/copa2026/CHANGELOG.md` v4.161, `bolao/br2026/CHANGELOG.md` v1.73,
`bolao/cdb2026/CHANGELOG.md` v3.52.

`audit_scoring.py`: PASSOU nos 3 apps, sem alteração — manipulação de string de assunto de
e-mail apenas, lógica de scoring/ranking intocada. `node --check` limpo nos 3 `app.js`.

## Nota manual — poll de placar ao vivo não retomava após segundo plano (2026-07-25, PLATFORM_SHARED)

Eduardo, depois de confirmar que "placar ao vivo sumiu" (nota anterior) era só cache do navegador:
"Still doesn't seem to be working as well as copa was. I have to refresh to get an updated score
and the clocks are not in sync with the actual game time. Something is off. Do a deep research."

**Causa raiz**: comparando `init()` do BR2026 linha a linha contra o da Copa — a Copa já chama
`startLiveScorePolling()` (poll imediato + rearma o loop) nos três eventos de retomada
(`focus`, `pageshow`, `visibilitychange`), correção feita depois de um incidente real anterior em
que uma aba retomada do segundo plano ficava presa no estado antigo em memória (ver
`docs/bolao/LESSONS_LEARNED.md` "Safari" / bfcache). O BR2026 já tinha os mesmos handlers
`pageshow`/`focus` — com o mesmo comentário explicando o problema do bfcache! — mas eles só
chamavam `debouncedReload()` (resync do Supabase), nunca `pollAll()`/`schedulePoll()` (poll de
placar/relógio da ESPN). Resultado: travar o celular ou trocar de app durante um jogo ao vivo e
voltar deixava placar e relógio congelados no último poll até um reload manual forçar um poll
novo — exatamente "tenho que atualizar pra pegar o placar" e "relógio fora de sincronia", já que
o relógio na tela continua interpolando pra frente a partir de uma base cada vez mais antiga sem
nenhum poll novo pra corrigir.

Confirmado como o mecanismo real (não suposição): reconstruído o BR2026 localmente com dados reais
da ESPN dos dois jogos do Brasileirão ao vivo hoje, e verificado que, antes do fix, um `pageshow`
simulando restauração de bfcache não disparava nenhuma requisição nova à ESPN; depois do fix,
dispara uma imediatamente.

**Fix (BR2026)**: `schedulePoll()` ganhou um token de geração — permite que uma retomada reinicie
a cadeia com segurança mesmo que a cadeia antiga ainda esteja viva em algum lugar (evita duas
cadeias de poll paralelas). Novo `resumeLivePolling()` (`pollAll(); schedulePoll();`) chamado em
`focus`, `pageshow` e `visibilitychange` — movido pra fora do bloco `if (C.database.enabled)`, já
que o poll de placar da ESPN não depende do Supabase estar ligado.

**Fix (CDB2026)**: mesmo achado, gap idêntico — `pollLiveTies()` usa `setInterval` simples (não a
cadeia auto-reagendada do BR2026), mas também nunca era rechamado explicitamente em
`focus`/`pageshow`/`visibilitychange`, só o resync do Supabase. Adicionados os mesmos três
listeners chamando `pollLiveTies()` diretamente. Nenhum jogo do CDB2026 está ao vivo hoje, então
isso não podia ter sido observado ainda na prática — mas é o mesmo padrão de plataforma, e a
Copa já resolve isso do mesmo jeito nos mesmos três eventos. Verificado da mesma forma
(pageshow simulado -> 0 requisições antes do fix, 1 depois).

Detalhe completo em `bolao/br2026/CHANGELOG.md` v1.74 e `bolao/cdb2026/CHANGELOG.md` v3.53.

`audit_scoring.py`: PASSOU nos 3 apps, sem alteração — mudança de agendamento de poll/listener de
evento apenas, lógica de scoring intocada. `node --check` limpo nos dois `app.js` alterados.

## Nota manual — jogos adiados contados como resultado real 0-0 na tabela ao vivo (2026-07-26, PLATFORM_SHARED)

Eduardo: "Verifique se os dados da tabela estão corretas em outros sites mostra pontuação
diferentes."

**Investigação**: reconstruída a tabela inteira do zero a partir dos resultados brutos da ESPN
(Python, independente do código do app) e comparada contra o endpoint oficial de standings da
própria ESPN — 0 divergências nas 20 equipes, uma vez excluídos corretamente os jogos adiados.
Ou seja, o feed da ESPN é internamente consistente; a divergência estava em como este app
classifica um jogo como adiado.

**Causa raiz**, confirmada rodando o código real da página com dados reais: `fetchSchedule()`
(BR2026) comparava a constante de máquina da ESPN (`status.type.name`, ex.:
`"STATUS_POSTPONED"`) contra o texto humano `"Postponed"` — nunca batia (o texto humano vive em
`status.type.description`, campo diferente). `postponed` ficava sempre `false`, e 4 jogos
remarcados reais (`state:"post"` mas `completed:false`) eram tratados como empates 0-0
encerrados por `windowCompletedMatches()`/`calculateLiveStandings()` — as mesmas funções por
trás da Tabela ao vivo e das zonas G4/Z4/SA6 usadas em todo lugar (Ranking, Projeção do Bolão).
Verificado via os test hooks já expostos da página com dados reais da ESPN: antes do fix, 8
equipes (Red Bull Bragantino, Botafogo, São Paulo, Atlético-MG, Santos, Grêmio, Vasco da Gama,
Chapecoense) apareciam com +1 ponto e +1 jogo além do valor correto; depois do fix, as 20
equipes batem exatamente com o standings oficial da ESPN.

**Fix**: `postponed` agora é `state === "post" && completed === false` — o sinal real e
confiável (verificado contra dados reais: os 191 resultados reais de fim de jogo têm
`completed:true`; os 7 adiados/cancelados têm `completed:false`; zero casos ambíguos).

Mesmo bug, mesmo fix, no CDB2026 (`isLegPostponed()`/`fetchLiveTies()`) — o comentário original
do código já dizia "portado do BR2026", e o bug veio junto na cópia (`"POSTPONED"` em vez de
`"STATUS_POSTPONED"`). Copa não tem componente equivalente de standings/detecção de jogo adiado
— sem propagação necessária lá.

Detalhe completo em `bolao/br2026/CHANGELOG.md` v1.78 e `bolao/cdb2026/CHANGELOG.md` v3.54.

`audit_scoring.py`: PASSOU nos 3 apps, sem alteração — corrige o parsing do status da ESPN que
alimenta a *projeção ao vivo*, não a fórmula de scoring do bolão em si, que não foi tocada.

## Nota manual — auditoria CDB2026 de 2026-08: dois achados são PLATFORM_SHARED (BR2026 também afetado)

Auditoria completa: `docs/bolao/CDB2026_CODE_AUDIT_2026-08.md`. Dois dos problemas confirmados no
CDB2026 existem, **com o mesmo código**, no BR2026 — foram corrigidos **apenas no CDB2026** (escopo
explícito da tarefa). Registrado aqui para não se perder, conforme a regra de propagação.

| Achado | Copa (`copa2026`) | BR2026 | CDB2026 | Status |
|---|---|---|---|---|
| Gravação remota sem read-merge-write (lost update: pagamento revertido / entrada concorrente apagada) | Usa o cliente Supabase e um merge próprio — **não** compartilha este caminho | **AFETADO** (`br2026/js/app.js` `saveRemoteState`, mesmo POST de estado inteiro) | **Corrigido** na v3.55 (read-merge-write) | `NEEDS_REVIEW` — propagar para BR2026 |
| `paid` mesclado por spread (local vence) em vez de any-true-wins | Correto (`mergedPaid[k] = !!(local \|\| remote)`) | **AFETADO** (`br2026/js/app.js`, spread idêntico) | **Corrigido** na v3.55 | `NEEDS_REVIEW` — propagar para BR2026 |
| Falha de gravação no Supabase tratada como sucesso (`.catch(() => {})`, sem checar `response.ok`) | Parcial: loga o erro, mas sem indicador para o usuário | **AFETADO** (mesmo padrão) | **Corrigido** na v3.55 (lança em `!r.ok` + toast `syncFailed`) | `NEEDS_REVIEW` — propagar para BR2026 |

**Por que não foi propagado agora:** a tarefa delimitou o escopo ao CDB2026 e pediu correções
cirúrgicas e reversíveis, com regressão explícita de que BR2026 e Copa **não** fossem tocados. As
correções acima são pequenas e diretamente transplantáveis, mas mexem no caminho de gravação de um
app em produção com dinheiro real — merecem sua própria rodada de teste/QA, não um efeito colateral
desta auditoria. **Risco enquanto não for propagado:** no BR2026, um participante com a aba aberta
há algum tempo pode reverter uma marcação de pagamento do admin ou apagar a entrada recém-criada de
outro participante ao salvar a sua.

Também corrigido só no CDB2026 (não existe equivalente no BR2026, que não usa este modelo de
confrontos): descarte dos flags de migração `espnSync` no merge.

## Nota manual — Fase 2 (modernização) do CDB2026, 2026-08: i18n de idioma único é intencional, `localFallback` é padrão compartilhado

Relatório completo: `docs/bolao/CDB2026_MODERNIZATION_REPORT_2026-08.md`. Dois achados desta fase
tocam consistência entre apps e ficam registrados aqui:

- **`bolao/cdb2026/js/i18n.js` só define `pt-BR`** — confirmado por leitura direta do arquivo
  (`window.CDB2026_I18N = { "pt-BR": {...} }`, nenhum objeto `es`/`en-US`), diferente da regra de
  3 idiomas documentada para a Copa em `CLAUDE.md`. **`INTENTIONALLY_DIFFERENT`** — a Copa do
  Brasil é uma competição doméstica (participantes brasileiros), diferente da Copa do Mundo. Não
  estava registrado como intencional antes desta auditoria; agora está.
- **`C.database.provider`/`C.espn.leagueSlug`/`C.database.localFallback`** em `config.js` não são
  lidos por nenhum código de `app.js` no CDB2026 (confirmado por grep). `localFallback` é
  compartilhado com os outros dois apps (mencionado em `PROJECT_MEMORY.md` como presente "nos
  três"); `provider`/`leagueSlug` seguem o mesmo padrão de schema com BR2026 (que tem ambos) e
  Copa (que tem `provider`). Não removidos unilateralmente do CDB2026 — mudar um padrão de schema
  compartilhado exige avaliação cross-app, fora do escopo de um patch de um app só.
- **Timezone do audit log admin (`America/New_York`, "ET") é inconsistente** com todos os outros
  timestamps administrativos do CDB2026 (recibo/rodapé/cutoff/CSV, todos BRT) — sem justificativa
  documentada encontrada. Não corrigido (mudaria o horário civil exibido, não é só formatação) —
  registrado em `CDB2026_RISK_CONTROL_MATRIX.md` para decisão do Eduardo.
- **`@supabase/supabase-js` é carregado via CDN no CDB2026 mas não usado** — `app.js` fala com a
  REST API do Supabase via `fetch()` puro, não via este SDK (confirmado por grep, zero chamadas
  `window.supabase.*`). Candidato a remoção do `<script>`, não removido nesta fase — ver
  `CDB2026_DEPENDENCY_INVENTORY.md`.

## Nota manual — "Ver palpites" do Ranking: destaque de linha por acerto/erro não existe na Copa (2026-08-01, CDB2026 v3.65)

`renderPickDisplay()` (CDB2026) e o equivalente `renderPickDisplay()`/`.pick-group` em BR2026
aplicavam uma classe de linha (`pick-exact`/`pick-partial`(CDB)/`pick-group`(BR)/`pick-miss`) que
dá fundo verde/amarelo às linhas certas e `opacity: .7` às erradas, na tabela "Ver palpites" do
Ranking. **A Copa (`picksTable()`, referência visual canônica) nunca fez isso** — suas linhas são
sempre `<tr>` plana, só a célula de Pts muda de cor (`.pick-pts.pos` verde vs. `<span
class="muted">—</span>`). Achado a partir da reclamação do Eduardo ("Negrito e não negrito
continua... tem que ser exatamente com o mesmo formato e ux da copa do mundo") — investigação de
código não achou diferença de `font-weight`, mas reprodução visual com Playwright + dado real de
produção mostrou que a `opacity: .7` das linhas erradas, ao lado de linhas com fundo colorido em
opacidade cheia, lê como "não negrito" vs. "negrito" mesmo sem diferença real de peso de fonte.

- **CDB2026**: corrigido nesta versão — `renderPickDisplay()` não aplica mais classe de linha;
  regras CSS `.picks-detail tr.pick-exact/.pick-partial/.pick-miss` removidas de
  `bolao/cdb2026/css/styles.css`. Agora 100% igual à Copa (`<tr>` sempre plana).
- **BR2026**: mesmo padrão ainda presente (`pick-group`/`pick-exact`/`pick-miss` em
  `bolao/br2026/js/app.js` e `bolao/br2026/css/styles.css`), **não alterado** nesta tarefa — não
  foi pedido e BR2026 ainda não está publicado (ver `CLAUDE.md`). Registrado aqui como divergência
  conhecida da Copa, a avaliar/decidir separadamente antes de propagar.

## Nota manual — side-scroll do iOS Safari voltou no CDB2026; overscroll-behavior-x adicionado só lá (2026-08-02, CDB2026 v3.70)

Eduardo, print do Ranking: "O dimensionamento da tela voltou a ter esse problema de scroll
vertical [sic, visualmente é horizontal — conteúdo alinhado à esquerda cortado, ex. 'Ranking'
aparecendo como 'anking']." Mesma classe de bug já documentada em `CHANGELOG.md` v3.31/v3.36
(rubber-band horizontal do iOS Safari por causa do `.topbar` com `position: sticky` +
`backdrop-filter`) — `overflow-x: clip` (já presente nos 3 apps) reduz mas não elimina 100% esse
bounce elástico nativo, e a tabela "Ver palpites" ficou mais larga depois da 4ª coluna adicionada
na v3.66, tornando o bounce mais perceptível ao arrastar dentro dela.

Adicionado só no CDB2026 (onde foi reportado): `overscroll-behavior-x: none` em `html, body`
(desliga o bounce elástico horizontal do navegador, em vez de só recortar seu efeito visual) e
`overscroll-behavior-x: contain` em `.picks-detail` (evita que um arraste até a borda da tabela
"encadeie" pro scroll da página). Não reproduzido no Chromium do sandbox (mesma limitação da
v3.36 — bounce é específico do WebKit/iOS Safari).

**Copa e BR2026 têm o mesmo `.topbar` sticky+backdrop-filter e o mesmo `overflow-x: clip` sem
`overscroll-behavior-x`** — candidatos ao mesmo reforço preventivo, não aplicados aqui (não
reportado nos outros dois; Copa é produção e só recebe patches avaliados individualmente por
`PLATFORM_GOVERNANCE.md`). Registrado aqui para decisão do Eduardo.

## Nota manual — Aba "Jogos" do CDB2026 alinhada ao "look and feel" da Copa/BR2026: chips de status, placar ao vivo, auto-scroll pro próximo jogo (2026-08-02, CDB2026 v3.74)

Eduardo: "A tab jogos da cdb e brasileirão devem funcionar da mesma maneira que copa do mundo e
ter o mesmo look and feel. E por default deve ir automaticamente para o próximo jogo. verifique
isso 100% sem retirar informações ou funcionalidades." BR2026 já tinha esse comportamento
(`.game-card.pre`/`showSection()`, código idêntico ao padrão da Copa
`.game-card[data-state="pre"]`) — só o CDB2026 estava sem. Auditado e corrigido:

- **Chip de status por perna** (`.game-status pre/live/post/postponed`): CDB2026 só mostrava a
  data OU o placar, sem nenhum rótulo — Copa/BR2026 sempre mostram um chip (Ao vivo/Encerrado/
  Agendado/Adiado). Adicionado em toda perna, reaproveitando as classes/cores CSS que já existiam
  desde a v3.26 (portadas mas nunca usadas fora do chip de "Adiado").
- **Placar/relógio ao vivo na aba Jogos**: antes só aparecia no card `#liveTieCard` isolado do
  topo; uma perna em andamento na aba Jogos continuava mostrando só a data antiga, como se ainda
  não tivesse começado. Agora consulta `_liveTies` (mesma fonte do card do topo) e mostra placar
  + relógio ao vivo (usando `liveClockDisplay()`, já reconciliado pelo fix da v3.73) direto na
  perna correspondente, com destaque de borda vermelha igual ao `.game-card.is-live` da Copa.
- **Auto-scroll pro próximo jogo**: `showSection("games")` agora rola automaticamente pra próxima
  perna ainda não iniciada ao abrir a aba, mesmo comportamento de Copa/BR2026. Implementado com
  `nextUpcomingLegKey()`, que reusa `flatLegsChronological()` (o helper de ordem cronológica real
  por PERNA, não por confronto, já usado por "Ver palpites"/comprovante/CSV desde a v3.67) — o
  simples "primeira `.pre` em ordem de DOM" que Copa/BR2026 usam não bastaria aqui: como um
  confronto do CDB2026 agrupa ida+volta no mesmo card, a volta (ainda sem data) de um confronto já
  iniciado poderia aparecer ANTES da ida de outro confronto com data mais próxima na ordem de DOM
  agrupada por confronto. Exclui pernas já ao vivo (mesmo critério de Copa/BR2026 — o jogo ao vivo
  já tem destaque próprio no card do topo).

**Estrutura de card por CONFRONTO (ida+volta agrupadas), com linha de agregado/"quem avança", NÃO
foi alterada** — é `TOURNAMENT_SPECIFIC` (mata-mata de duas pernas, sem equivalente na Copa/
BR2026) e nenhuma informação existente foi removida (venue, agregado, classificado, rótulo de
ida/volta, chip de adiado — todos preservados, só ganharam companhia do chip de status novo).
Verificado com Playwright + estado real de produção + partida ao vivo simulada (mesmo mock da
v3.73): confronto-cards, agregados e "quem avança" continuam idênticos ao antes; chip/placar ao
vivo e auto-scroll confirmados funcionando.

## Nota manual — branch `fase2.2-correcao-final`: harness visual real, padronização de tabs, aria-current, e item 8 (padding/form-grid) autorizado (2026-08, Copa v4.166 / BR2026 v1.85 / CDB2026 v3.83)

Rodada de várias sessões consolidando a correção final da FASE 2.2 (ver
`docs/bolao/FASE2.2_CORRECAO_FINAL_REPORT.md` para o relato completo, sessão a sessão, incluindo
o que ficou pendente entre rodadas). Resumo do que mudou na plataforma nesta branch, na ordem em
que foi implementado:

1. **Cache-bust tooling** (`bolao/cdb2026/scripts/check_cachebust.mjs`, `sync_version.yml`):
   corrigido para INSERIR `?v=` quando ausente (os três `index.html` referenciavam os 5 assets
   críticos sem nenhuma query), não só substituir uma já existente. `index.html` dos três apps
   não foi tocado à mão (regra do Eduardo: o bot `sync_version.yml` cuida disso). PLATFORM_SHARED.
2. **`aria-current="page"` na tab ativa** (cherry-pick de `main`, depois validado por uma suíte
   Playwright nova — `bolao/scripts/test_aria_current_nav.mjs`): confirma, com mouse E teclado
   nos três apps, que exatamente um botão tem `aria-current="page"` a qualquer momento, que
   nenhum `aria-selected` é usado em lugar nenhum (navegação simples, não um tab-widget ARIA), e
   que o atributo sempre acompanha a classe `.active`. Resolve o item H-3/P2 que
   `VISUAL_STANDARDIZATION_REPORT.md` (2026-08-02) tinha listado como pendência aberta —
   **agora fechado**. PLATFORM_SHARED (acessibilidade).
3. **Overflow real em `cdb2026 Jogos@320x568`** corrigido de verdade (`.leg-info` ganhou
   `white-space:normal`/`min-width:0` no breakpoint `max-width:600px` já existente) — não
   mascarado com `overflow-x:hidden`. Harness de evidência (`capture_evidence.mjs`) recapturado:
   0 overflow em 112 entradas (era 1). DATA_ONLY/CDB2026 apenas (bug específico do layout de
   `.leg-info` desse app).
4. **Tabs — contagem de colunas do `.nav` corrigida para o nº real de botões visíveis** (era
   `repeat(8,...)`/`repeat(9,...)`/`repeat(6,...)` com 2 colunas mortas na Copa/BR2026; virou
   `repeat(6,...)` Copa, `repeat(7,...)` BR2026, `repeat(6,...)` CDB2026 desktop) + padronização
   mobile pras 3 colunas nos três (era só BR2026/CDB2026; Copa tinha `repeat(4,1fr)`/
   `repeat(8,1fr)` próprios) + um bug real de "orphan row" corrigido (BR2026 tinha o botão
   "Admin" sozinho na última linha mobile, 1/3 de largura, achado por screenshot real a 320px).
   **Isto substitui as linhas "Tabs" e "Navegação mobile" de
   `docs/bolao/VISUAL_PARITY_MATRIX.md`** (linhas 34/36), que descrevem o estado ANTERIOR a esta
   correção (Copa 8/BR2026 9/CDB2026 6 colunas desktop; Copa 4/8 colunas mobile vs. 3 nos outros
   dois) — ver aviso no topo daquele arquivo. PLATFORM_SHARED.
5. **Captura de admin autenticado** (`bolao/cdb2026/scripts/visual/capture_admin_auth_evidence.mjs`):
   sessionStorage sintético (nunca senha real) reproduzindo as chaves exatas que cada
   `isAdminActive()` verifica — cobre BR2026/CDB2026 (Copa arquivada, marcada `notApplicable`,
   mesmo tratamento que as demais seções arquivadas).
6. **`bolao/scripts/audit_visual_consistency.mjs`** (novo, cross-app, fora de qualquer pasta de
   app individual): compara `getComputedStyle()` de 26 componentes × 13 propriedades entre os
   três apps, classifica EQUAL/EQUIVALENT/JUSTIFIED/DIVERGENT/N/A. Relatório completo:
   `docs/bolao/evidence/visual-comparison/audit_visual_consistency.{json,md}`. Encontrou e
   corrigiu 2 bugs reais de seletor no próprio script durante a construção (`select` pegando o
   elemento errado, `button-primary` não casando com nenhum app) antes de confiar no resultado.
7. **Montagens lado a lado Copa\|BR2026\|CDB2026** (`bolao/scripts/make_visual_comparison_montages.mjs`):
   28 montagens (7 telas × 4 viewports), reaproveitando screenshots já existentes — sem nova
   captura. Seções ausentes (Copa arquivada, BR2026 Palpites fechado) mostram um placeholder
   rotulado com o motivo real, nunca um vão em branco.
8. **Item 8 — `main` padding + `.form-grid` alinhados à Copa, autorizado explicitamente pelo
   Eduardo** (commit `f0d253d`): `main` padding `16px 14px`→`20px 18px` em BR2026/CDB2026;
   `.form-grid` `repeat(auto-fill, minmax(220px,1fr))` gap `14px` → `repeat(2, minmax(0,1fr))`
   gap `12px`, com o mesmo colapso pra 1 coluna em `@media (max-width:900px)` que a Copa já
   tinha (BR2026/CDB2026 não tinham essa regra — adicionada). **Achado extra durante a
   verificação**: sem essa regra de colapso, o formulário de entrada renderizava **3 colunas
   espremidas a 768px** (largura de tablet) sob o `auto-fill` antigo — confirmado por sonda de
   `getComputedStyle` (`gridTemplateColumns` resolveu para pixels reais, não a string
   `repeat()`, confirmando que o grid estava de fato renderizado) e captura de tela real. A Copa,
   na mesma largura, já colapsava pra 1 coluna. Ou seja, esta correção fecha uma divergência real
   de tablet, não só o alinhamento >900px descrito originalmente. Verificado com screenshots
   reais 320/768/1440px antes/depois nos três apps: nenhum overflow horizontal novo, nenhuma
   sobreposição do `.sticky-submit` (que é `display:flex` em fluxo normal, não `position:fixed`/
   `sticky`, apesar do nome). Reauditoria com `audit_visual_consistency.mjs`: `main:padding`,
   `form-grid:gap` e `form-grid:gridTemplateColumns` viraram EQUAL nos três apps (342 EQUAL/1
   JUSTIFIED/21 DIVERGENT, era 339/1/24). `form-grid:margin` continua DIVERGENT (`0px` na Copa
   vs. `0px 0px 16px` em BR2026/CDB2026) — **fora do escopo autorizado** deste item (só
   `padding`/`grid-template-columns`/`gap` foram pedidos), registrado aqui como dívida técnica
   não corrigida, não escondido. PLATFORM_SHARED (visual, `main`/`.form-grid` são compartilhados
   pelos três apps).

Em todos os itens acima: `node --check` limpo e `audit_scoring.py` 6/6 (Copa) / 5/5 (BR2026) /
5/5 (CDB2026) rodados e confirmados a cada mudança — nenhum item tocou scoring, bracket, tiebreak
ou regra de negócio. Ver commits individuais em `git log` desta branch para o hash exato de cada
item.

## Nota manual — migração para o framework visual compartilhado `bolao/shared/css/` (2026-08-04, branch `visual-framework-copa-canonical`, Copa v4.169+tooling / BR2026 v1.89+tooling / CDB2026 v3.89+tooling)

Migração de 6 fases movendo os componentes visuais canônicos da Copa (referência golden-master,
ver `CLAUDE.md`) para `bolao/shared/css/{tokens,reset,shell,navigation,components,forms,admin,
responsive}.css`, consumidos pelos três apps via `<link>` antes do `css/styles.css` próprio de
cada um. Fase 1 catalogou os valores reais da Copa
(`docs/bolao/CANONICAL_VISUAL_COMPONENT_CATALOG.md`); fases 2-4 migraram Copa/BR2026/CDB2026 uma
de cada vez, com commit de checkpoint próprio; fase 5 padronizou o admin e adicionou
`bolao/scripts/check_shared_visual_contract.mjs` (gate estático que barra qualquer app local
redefinindo uma propriedade protegida de um seletor protegido sem sufixo de variante formal);
fase 6 documentou evidência (`docs/bolao/evidence/canonical-framework/`) e fez o wrap-up.

**Itens que ERAM divergência (`DIVERGENT` implícito, nunca formalmente catalogado) e agora são
`CONSISTENT`/compartilhados de fato, não só por inspeção**: topbar, brand, whatsapp-btn,
bolao-switcher, lang-links, `main`/`.card` (base), `h1-h3`, `.section-head`, `.form-grid`/input/
select, `.admin-toolbar`, `.hidden`, `.muted`, focus-visible/h2:focus, toast, `.rank-row`/
`.points` (base), `.game-card` (box: background/border/radius/padding), botões (primary/
secondary/danger), `.rules-table` (regras compartilhadas de `td`). Todos os três apps agora leem
a MESMA declaração-fonte para esses componentes — não há mais 3 cópias que podem divergir
silenciosamente numa mudança futura, é o que `check_shared_visual_contract.mjs` (fase 5) passou a
impedir automaticamente.

**Divergências mantidas, DOCUMENTADAS como `VARIANT_APPROVED`/`TOURNAMENT_SPECIFIC` (não
corrigidas, decisão consciente registrada em cada fase)**:

1. **Contagem de abas do `.nav` no desktop** — Copa 6, BR2026 7 (inclui "Tabela"), CDB2026 6.
   Resolvido via `--nav-cols-desktop` (custom property em `bolao/shared/css/tokens.css`, default
   6) em vez de bifurcar a regra `.nav` compartilhada — cada app só sobrescreve o valor no
   próprio `:root`. Fase 3 (BR2026) escolheu esse caminho sobre um fork local justamente para
   manter uma única regra `.nav` real nos três apps.
2. **Fórmula do botão órfão de nav no mobile** — Copa/BR2026 usam `nth-child(3n)` (têm botões
   ocultos de Participantes/Pagamento DENTRO de `.nav`, deslocando a contagem DOM); CDB2026 usa
   `nth-child(3n+1)` (mantém esses botões em `.nav-secondary`, fora de `.nav`, sem deslocamento).
   Achado real de regressão na fase 4: aplicar a fórmula compartilhada (pensada pra Copa/BR2026)
   ao CDB2026 sem ajuste teria espalhado incorretamente o 6º botão real (já uma linha cheia) —
   corrigido com um reset explícito local antes da regra correta.
3. **Estrutura do card de confronto de mata-mata** — Copa/BR2026 usam uma linha só (`.game-card`
   + `.game-teams`/`.game-team`), CDB2026 usa duas linhas por confronto (ida/volta,
   `.confronto-card`/`.confronto-legs`/`.leg`). O CDB2026 tem sorteio progressivo com mata-mata
   de ida-e-volta em várias fases (ver `docs/bolao/CDB2026_RULES_AND_MODEL.md`) — diferença real
   de formato de torneio, não generalizada entre apps (`PLATFORM_GOVERNANCE.md`). A caixa visual
   (background/border/radius/padding) do `.confronto-card` já vem do `.card` compartilhado desde
   a fase 4; só a estrutura interna (linhas de ida/volta) permanece própria do CDB2026.
4. **Alinhamento do `.sticky-submit`** — Copa usa `justify-content: flex-end` (valor
   canônico, agora em `bolao/shared/css/forms.css`); BR2026 e CDB2026 mantêm
   `justify-content: center` como override local. Divergência pré-existente à migração,
   sinalizada nas fases 3 e 4 mas **não corrigida** sem autorização explícita do Eduardo — CSS
   puramente visual, mas mudar o alinhamento de um CTA de submissão não é uma correção óbvia o
   bastante pra decidir sozinho.
5. **`.prob-bar` `min-width`** — Copa/compartilhado usa `6px`; BR2026 e CDB2026 usam `32px`
   (a barra deles mostra um rótulo de porcentagem dentro do segmento, precisa de mais espaço).
   Pré-existente à migração, carregado como override local nas fases 3-4 sem ter sido nomeado
   como divergência formal até a fase 6 (`docs/bolao/evidence/canonical-framework/
   COMPONENT_AUDIT.md`) — reclassificado aqui como `DIVERGENT` conhecido, não corrigido.
6. **Nomes de classe geradas por JS não renomeados para as canônicas da Copa** —
   `.game-matchup`/`.match-team`/`.match-team-name` (BR2026), `.confronto-legs`/`.leg`/
   `.leg-label`/`.leg-teams` (CDB2026), `.game-status` (BR2026/CDB2026, em vez de
   `.status-chip`). Decisão consciente nas fases 3-4: esses seletores são gerados por
   `js/app.js` de cada app, e renomear exigiria tocar `.js` sem ganho visual (os valores
   declarados já espelham os tokens compartilhados 1:1, verificado por inspeção). Dívida técnica
   registrada, não escondida: se o token compartilhado mudar no futuro, essas cópias locais
   precisam ser atualizadas manualmente — não há mais garantia estrutural de que fiquem em
   sincronia (diferente dos componentes que agora leem a mesma declaração-fonte).

Em todos os itens acima: `node --check` limpo (19/19 arquivos `.js`), `audit_scoring.py` 6/6
(Copa) / 5/5 (BR2026) / 5/5 (CDB2026), `audit_golden_master.mjs`/`audit_state_merge.mjs`/
`audit_integrity.py`/`check_cachebust.mjs` (CDB2026) e `check_shared_visual_contract.mjs`
(plataforma) todos passando — rodados e confirmados a cada fase e novamente na fase 6. Nenhuma
fase tocou scoring, bracket, tiebreak, autenticação admin, persistência ou regra de negócio.
Nenhuma captura de tela real foi feita nesta sessão (sem navegador/ferramenta de screenshot
disponível, verificado antes de assumir — ver `docs/bolao/evidence/canonical-framework/
README.md`); a classificação acima é por comparação estática de CSS/markup, não por renderização
visual confirmada. Ver commits individuais em `git log` da branch
`visual-framework-copa-canonical` para o hash exato de cada fase.

## Nota manual — validação visual real (Playwright + Chrome real) e reclassificação das divergências (2026-08-04, fase 7, branch `visual-framework-copa-canonical`)

A fase 6 documentou a migração usando só comparação estática de CSS/markup, sem navegador real —
Eduardo apontou que isso não bastava. Esta fase instalou Playwright de verdade
(`npm install --no-save playwright`, escopo local ao checkout, não committado como dependência —
o repositório continua sem build step) e usou um binário real do Chrome
(`~/Library/Caches/ms-playwright/chromium-1234/`, via `PLAYWRIGHT_CHROMIUM_PATH`, o mesmo
mecanismo que os scripts `bolao/cdb2026/scripts/visual/*.mjs` já suportavam) para rodar as
ferramentas de captura/comparação **já existentes e já revisadas** neste repositório
(`capture_evidence.mjs`, `capture_admin_auth_evidence.mjs`, `check_sticky_overlap.mjs`,
`bolao/scripts/audit_visual_consistency.mjs`, `bolao/scripts/make_visual_comparison_montages.mjs`)
— nada foi reinventado.

**Achado real, corrigido**: a primeira rodada de captura teve 7 falhas, todas no CDB2026
("Palpites"). Causa raiz: `isPastEntryCutoff()`/`effectivePhaseCutoffMs()`
(`bolao/cdb2026/js/app.js`) calculam o cutoff de entrada a partir do PRIMEIRO kickoff conhecido
da fase ativa; a fixture de teste (`bolao/cdb2026/scripts/visual/game_fixtures.mjs`) tinha duas
partidas datadas `2026-08-04`/`2026-08-05` (usadas só pra testar os estados "adiado"/"ao vivo")
que, ao "hoje" deste sandbox alcançar `2026-08-04`, se tornaram o kickoff mais cedo da fase e
fecharam o cutoff — a app passou a abrir direto em Ranking, escondendo o formulário de Palpites.
**Dívida de fixture de teste, não bug de CSS nem de regra de negócio** — corrigido movendo as
duas datas pra 2031 (mesma convenção já usada pelo resto da fixture). Depois da correção: 77/77
capturas aplicáveis com sucesso, 0 falhas; `audit_visual_consistency.mjs` foi de 8 divergências
não aprovadas para **0**.

**Verificações reais realizadas** (não só leitura de código): 30 componentes × getComputedStyle
real (383 EQUAL / 23 JUSTIFIED / 0 DIVERGENT / 14 N/A); 28 montages reais lado a lado (Copa
sempre a primeira coluna), 4 viewports; 0 erro de console real (só CORS de ESPN esperado, sem
internet neste sandbox) em 3 apps × 3 viewports; 0 overflow horizontal em 3 apps × 3 viewports; 0
sobreposição de `.sticky-submit` em 7 viewports × 5 posições de scroll
(`check_sticky_overlap.mjs`).

### Investigação e correção real: `.prob-bar` `min-width`

Determinado empiricamente (Playwright real) que `min-width: 6px` (valor canônico anterior, da
Copa) faz o rótulo de porcentagem que os TRÊS apps renderizam dentro de todo segmento
(`label(pct,name)` — código da PRÓPRIA Copa, `bolao/copa2026/js/app.js:2656`, nunca retorna string
vazia) ficar genuinamente cortado (`scrollWidth 22px > clientWidth 19px` para um segmento de 3%
em 390px) — um bug de legibilidade real do lado da Copa, não uma variante legítima do BR2026/
CDB2026. `min-width: 32px` (valor que BR2026/CDB2026 já carregavam como override local não
documentado) renderiza sem corte (`scrollWidth === clientWidth`). **32px promovido ao valor
canônico compartilhado** (`bolao/shared/css/components.css`), overrides locais do BR2026/CDB2026
removidos (agora duplicata verdadeira, não mais necessária).

### Reclassificação das divergências preservadas (categorias solicitadas por Eduardo)

| Divergência | Categoria | Justificativa |
|---|---|---|
| `--nav-cols-desktop` (contagem de abas por app) | **VARIANTE FUNCIONAL LEGÍTIMA** | Cada app tem um número real e diferente de abas visíveis (Copa 6, BR2026 7 com "Tabela", CDB2026 6) — não é possível ter a mesma contagem sem esconder ou inventar uma aba. Resolvido via custom property, uma única regra `.nav` real para os três apps. |
| Fórmula `nth-child` do botão órfão de nav (CDB2026) | **VARIANTE FUNCIONAL LEGÍTIMA** | Diferença real de estrutura DOM (CDB2026 mantém Participantes/Pagamento fora de `.nav`, Copa/BR2026 mantêm dentro, ocultos) — a fórmula compartilhada aplicada sem ajuste teria introduzido uma regressão real (already avoided, fase 4). |
| Estrutura do card de confronto (ida/volta vs linha única) | **VARIANTE FUNCIONAL LEGÍTIMA** | CDB2026 tem sorteio progressivo com mata-mata de ida-e-volta em várias fases (regulamento real, `CDB2026_RULES_AND_MODEL.md`) — Copa/BR2026 não têm esse formato. Confirmado por captura real: tipografia/cor/padding/radius/badge da CAIXA (`.card`) são EQUAL nos três; só a estrutura interna difere, por necessidade do formato do torneio. |
| Nomes de classe geradas por JS não renomeados (`.game-status`, `.match-team-name`, `.leg-teams`, etc.) | **DÍVIDA TÉCNICA** | Valores declarados conferem 1:1 com o token compartilhado HOJE (verificado por captura real + inspeção), mas não há mais garantia estrutural: se o token compartilhado mudar no futuro, essas cópias locais não são pegas por `check_shared_visual_contract.mjs` (seu conjunto de seletores protegidos não inclui esses nomes específicos de app). Risco real, registrado, não escondido. |
| `.sticky-submit` alinhamento (`center` vs `flex-end`) | **BUG VISUAL — CORRIGIDO NESTA FASE** | Não é diferença de torneio: é o MESMO botão "Salvar palpites" no MESMO contexto de formulário, sem motivo funcional pra alinhar diferente. Mantido como "divergência preservada" por 4 fases sob a desculpa de "aguardando autorização" — Eduardo autorizou explicitamente nesta fase ("alignment differences are NOT excused just because the tournament structure differs"). BR2026/CDB2026 agora herdam o valor canônico (`flex-end`) da Copa, override local removido. |
| `.prob-bar` `min-width` (32px vs 6px) | **BUG VISUAL — CORRIGIDO NESTA FASE** | Ver seção acima — 6px (valor antigo da Copa) cortava o rótulo de porcentagem; 32px (já usado por BR2026/CDB2026) é o valor legível/correto, promovido a canônico. |

Em todos os itens desta fase: `node --check` limpo (19/19 `.js`), `audit_scoring.py` 6/6 (Copa) /
5/5 (BR2026) / 5/5 (CDB2026), scripts específicos do CDB2026
(`audit_golden_master.mjs`/`audit_state_merge.mjs`/`audit_integrity.py`/`check_cachebust.mjs`) e
`check_shared_visual_contract.mjs` (plataforma) todos passando. Nenhuma mudança tocou scoring,
bracket, tiebreak, autenticação admin ou persistência — as duas correções reais desta fase
(`.prob-bar` min-width, `.sticky-submit` alignment) são puramente CSS, e a correção de fixture
(`game_fixtures.mjs`) é ferramenta de teste, não código de produção. Ver
`docs/bolao/evidence/canonical-framework/README.md` para o relato completo da captura real.

## Congelamento permanente do roster de entradas (`entryRosterFrozen`) — 2026-08-07

| Divergência | Categoria | Justificativa |
|---|---|---|
| `CONFIG.entryRosterFrozen` + `isEntryCreationAllowed()`/`editingEntryIsValid()`/`updateExistingEntry()` existem só no CDB2026 | **TOURNAMENT_SPECIFIC — INTENTIONALLY_DIFFERENT** | Só o CDB2026 tem a combinação que exige a flag: inscrições encerradas em definitivo **e** palpites que ainda reabrem três vezes (quartas, semifinal, final). Sem ela, cadastrar o sorteio da próxima fase torna o cutoff da fase ativa futuro, `isPastEntryCutoff()` vira `false` e a inscrição reabre sozinha. A Copa2026 está arquivada (`CONFIG.archived`, nenhum formulário ativo) e o BR2026 encerrou as inscrições em 2026-07-16 sem reabertura de palpites prevista — nos dois, o cutoff sozinho basta. Não propagar. Se algum dos outros apps passar a ter fases de palpite reabrindo depois do fechamento das inscrições, esta flag deve ser adotada lá também. |

**Limitação registrada (não é dívida escondida):** `entryRosterFrozen` é um controle de camada de
aplicação — cobre o formulário público, o admin e `applyAdminMutation`. Não é fronteira de
segurança de banco e não impede insert direto na tabela do Supabase por fora do app. Enforcement
no banco (RLS/constraint) fica para a modernização, em trabalho separado — deliberadamente não
implementado no Batch 0.

## TEST ISOLATION — gravação remota fail closed (P0) — 2026-08-07

Documento completo: `docs/bolao/TEST_ISOLATION.md`. Suíte: `bolao/scripts/audit_test_isolation.mjs`.

| Área | Categoria | Situação |
|---|---|---|
| Guard `productionWritesAllowed()` dentro de `saveRemoteState()` | **PLATFORM_SHARED — PROPAGADO NOS TRÊS** | Copa2026 (v4.171), BR2026 (v1.91), CDB2026 (v3.96). Mesma regra, mesma posição (antes de qualquer chamada remota), mesmas mensagens. Verificado por suíte, não por inspeção: o check de chokepoint falha se o guard for neutralizado em qualquer um dos três. |
| Chave do escape hatch namespaced por app (`copa2026_`/`br2026_`/`cdb2026_allow_production_writes`) | **INTENTIONALLY_DIFFERENT** | Uma chave compartilhada faria um override deliberado em um app liberar silenciosamente os outros dois. O prefixo por app é a diferença correta e é testada. |
| Valor de retorno do early-return do guard (`undefined` no BR2026, `false` na Copa, objeto `{ok:false,skipped:true}` no CDB2026) | **INTENTIONALLY_DIFFERENT** | Cada guard devolve o que o `if (!C.database.enabled)` / `if (!initDb())` daquele app já devolvia, para não mudar o contrato que os chamadores daquele app assumem. Unificar o valor de retorno é refatoração de persistência — não se mistura com um patch de segurança (regra "nunca misturar refatoração com correção"). |
| Leitura remota (`loadRemoteState`) **não** é bloqueada | **DECISÃO REGISTRADA** | O incidente foi de ESCRITA. Bloquear a leitura tiraria a capacidade de reproduzir o estado real num preview local, que é justamente como se investiga incidente, e leitura não pode corromper produção. Se um dia a leitura passar a ter efeito colateral remoto, esta decisão precisa ser revisitada. |

**Limitação registrada (não é dívida escondida):** controle de camada de aplicação. Não impede um
POST direto na REST API do Supabase com a anon key (pública por construção). Fecha o vetor que
causou o incidente — um harness carregando a aplicação — não todos os vetores. Enforcement real
(RLS por role/origem) fica para a modernização do banco e segue como o risco de produção aberto de
maior severidade.

### Hotfix da origem de produção — 2026-08-07 (mesma sessão)

| Item | Categoria | Situação |
|---|---|---|
| `PRODUCTION_ORIGINS` (allowlist) em vez de `PRODUCTION_ORIGIN` (string), derivado do `CNAME` | **SECURITY — CORRIGIDO NOS TRÊS** | copa2026 v4.172, br2026 v1.92, cdb2026 v3.97. A primeira versão do guard usou `ferrarilabs.github.io`, que responde 301 para `www.ferrarilabs.com` (o `CNAME` real): o guard bloqueava TODA gravação de produção nos três apps, em silêncio. Pego na verificação ao vivo, não pela suíte. `audit_test_isolation.mjs` agora lê o `CNAME` e falha se o domínio real não estiver na allowlist (verificado por controle negativo). |

## BATCH 4 — progressão QF → SF → Final (CDB2026 v3.107) — 2026-08-08

| Área | Categoria | Situação |
|---|---|---|
| Modelo de topologia + `register-bracket-topology` + resolução de participante derivada | **TOURNAMENT_SPECIFIC — não propagado** | Só a Copa do Brasil tem fase derivada sem sorteio próprio (um único sorteio, a partir das quartas). A Copa do Mundo tem bracket completo desde o sorteio de grupos e está arquivada; o BR2026 é liga de pontos corridos e não tem conceito de confronto eliminatório. Propagar seria copiar lógica de torneio, o que a regra do golden master proíbe explicitamente. |
| Objeto de fase montado por SPREAD em `applyMutationOverRemote()` (defeito corrigido) | **PLATFORM_SHARED por classe — auditado nos três, aplicável só ao CDB2026** | Copa2026 e BR2026 **não têm** `applyMutationOverRemote()` nem estado por fase (`phases[].officialDraw`): verificado por busca direta nos dois `app.js`, zero ocorrências. Não existe equivalente para corrigir. A classe de regressão ("campo novo some porque o objeto é reconstruído enumerando campos") permanece registrada como risco geral — ao introduzir estado por fase em qualquer app, montar por spread. |
| Chaves i18n `winnerOfPrefix` / `toBeDefined` / `topologyUnpublished` | **TOURNAMENT_SPECIFIC** | Só fazem sentido onde existe vaga derivada não resolvida. CDB2026 tem um único locale (`pt-BR`); as três chaves existem nele e são cobertas por teste que falha se um rótulo cru vazar. |

## Identidade de entrega do comprovante — cross-path (CDB2026) — 2026-08-16

Incidente e endurecimento completos: `docs/bolao/CDB2026_RECEIPT_IDENTITY_INCIDENT_2026-08-16.md`.
Suíte: `bolao/cdb2026/scripts/test_receipt_catchup_dedupe.py` (offline).

| Área | Categoria | Situação |
|---|---|---|
| Identidade de entrega = **entrada + versão gravada**, independente de transporte (chave e família canônicas de produção usadas por todo remetente automático) | **TOURNAMENT_SPECIFIC — auditado nos três, aplicável só ao CDB2026** | O CDB2026 é o único app com mais de um remetente para o mesmo documento (fila normal, dois catch-ups one-off, teste de template aceito como recibo real, caminho legado do navegador). Copa2026 não usa `notification_deliveries` e está arquivada. BR2026 usa `round_notification_ledger`, cuja identidade já é `(round_number, entry_ref)` — uma identidade por fato de negócio, independente de transporte, por construção; `round_catchup_dryrun.py` é só leitura e nunca envia. Nada a propagar: os outros dois já estão do lado certo. |
| `cdb_has_accepted_receipt(entrada, versão)` + registro de famílias reconhecidas | **TOURNAMENT_SPECIFIC** | Depende de `cdb_picks_version` e da forma canônica de palpite do CDB. Não existe equivalente nos outros dois. |
| Falha fechada em `uncertain` / `claimed` / RPC ausente / destinatário não resolvível | **PLATFORM_SHARED por classe — regra registrada, não código compartilhado** | A regra ("talvez tenha recebido nunca autoriza reenvio") vale para qualquer remetente da plataforma. BR2026 já a segue: `_ledger_key()` cai fechado sem `SUPABASE_SERVICE_ROLE_KEY`, e `REAL_SEND_REQUIRES_ATOMIC_LEDGER` exige o ledger atômico para envio real. Registrada em `LESSONS_LEARNED.md`. |
| Escopo temporal explícito obrigatório para envio real (`--target-date`) | **PLATFORM_SHARED por classe — auditado** | Aplicável a qualquer ferramenta de envio em lote. BR2026 opera por número de rodada (`--round N`), que já é escopo explícito e não deriva de "hoje". Copa2026 arquivada. Nenhuma mudança necessária nos outros dois. |
| Diagnóstico de operador lê o estado autoritativo (confrontos virtuais resolvidos), não a contagem de confrontos registrados | **TOURNAMENT_SPECIFIC** | Só o CDB2026 tem fase derivada não materializada (semifinal/final). Classificado `WRONG_DIAGNOSTIC_SOURCE`: a projeção pública **não** foi alterada — mudou a ferramenta de operador. |
| Scripts one-off de catch-up arquivados e desarmados em `scripts/archive/` | **DECISÃO REGISTRADA** | Os corpos ficam preservados byte a byte como evidência do incidente; a guarda `raise SystemExit` fica no nível de módulo, não em `__main__`, porque `python3 -c "import ..."` é um caminho de execução tão real quanto rodar o arquivo. Convenção nova: **remetente one-off que cumpriu seu propósito vai para `archive/` desarmado, nunca fica no diretório de ferramentas.** |

## Palpite contra confronto VIRTUAL na superfície de leitura pública (CDB2026) — 2026-08-16

Auditoria de persistência ponta a ponta. Relatório e evidência:
`~/Documents/GitHub/ferrarilabs-work/audits/cdb-persistence-20260816/`.

| Área | Categoria | Situação |
|---|---|---|
| `bolao_state_normalized_public` perde `picks` contra slug sem linha em `bolao.ties` (`sf-1`, `sf-2`, `final-1`) | **CRITICAL_DIVERGENCE — CDB2026, correção pendente de autorização** | O `readTable` do navegador monta `picks.qualified` com `JOIN bolao.ties`. Confronto virtual não tem linha ali, então some. Medido: 5 das 12 entradas aparecem com 15 palpites em `bolao_state` e **12** na projeção, sem campeão nem vice. Efeito hoje: ranking, card de pódio, "Ver palpites" e CSV mostram campeão "—". Efeito quando a final for jogada: `predictedPodium()` devolve `null` e os 30 + 20 de bônus não são somados. O dado NÃO está em risco — o navegador não grava mais o documento inteiro e o participante edita a partir de `cdb_my_entry`, que lê o documento autoritativo. O caminho de ESCRITA já trata o caso (`bolao.cdb_authoritative_document()` remescla o resíduo); falta o mesmo na LEITURA. |
| Asserção `MIRROR_DIVERGENCE` de `cdb_mirror_entry_picks` não pode pegar a divergência acima | **FALSO-VERDE ESTRUTURAL — registrado** | `_mirror_want` é montada com **o mesmo** `join bolao.ties` que depois é comparado com `bolao.predictions`. Valor esperado e valor medido passam pelo mesmo filtro. Classe: "expected value imported from the same implementation table" (`docs/bolao/FALSE_GREEN_AUDIT.md`). Qualquer asserção de espelho nova deve derivar o esperado do payload ACEITO, não da projeção do payload. |
| `receipt_render.ties_virtuais()` exigia `topology` já achatada | **CORRIGIDO 2026-08-16** | Contrato implícito cumprido só por `receipt_catchup_tool.snapshot_de()`. `slots_da_topologia()` passou a aceitar as duas formas; o fixture de `test_receipt.py` passou a ser o documento real e o §12 prova que as duas produzem HTML idêntico. Não aplicável a Copa2026/BR2026 — nenhum dos dois tem fase derivada. |
| `.rollback.sql` moravam em `supabase/migrations/` | **CORRIGIDO 2026-08-16 — movidos para `supabase/rollbacks/`** | O Supabase CLI trata todo `*.sql` do diretório como migração: `db push --include-all` lista os arquivos de rollback junto com os de avanço, e dois arquivos compartilhando o mesmo prefixo de versão fazem o ledger reportar a versão como parcialmente aplicada. Consequência prática: **`db push` não é utilizável neste repositório** — migração nova tem de ser aplicada arquivo a arquivo. Os 14 arquivos foram movidos byte a byte com `git mv` (0 linhas alteradas, nenhum executado) para `supabase/rollbacks/`, com README próprio; a regra 5 de `supabase/migrations/README.md` passou a proibir rollback naquele diretório. Efeito medido: `db push --include-all --dry-run` caiu de **17** para **5** arquivos. As 2 migrações antigas que ainda apareciam foram reconciliadas em seguida — ver a linha seguinte. |

| 2 migrações antigas pendentes bloqueavam qualquer `db push` | **RECONCILIADAS 2026-08-16** | Depois de mover os rollbacks, o `dry-run` ainda listava `20260813040000_outbox_pending_by_type.sql` e `20260813050000_confirmation_payload_carries_snapshot.sql`. Classificadas por MEDIÇÃO contra produção, não por timestamp, e resolvidas de formas DIFERENTES. **`040000` APLICADA**: cria só `outbox_pending_count(text)`, ausente de produção, nenhuma migração posterior a define, dois scripts ainda a chamam (dentro de `try/except`, porque observabilidade não pode derrubar entrega), contagens só-leitura e `service_role` apenas — efeito genuinamente faltando e desejado. **`050000` APOSENTADA** para `supabase/retired/`, nunca executada: seu `cdb_save_my_picks` **já lê** `bolao.cdb_authoritative_document()` (o arquivo foi rebaseado depois do cutover) e é semanticamente IDÊNTICO ao de `20260816010000`, que ainda acrescenta o bloco de autoverificação; e seu outro objeto, `cdb_current_receipt_snapshot`, está ausente, **não tem chamador nenhum** (o teste de template monta o snapshot em Python) e leria o documento legado — a auditoria de 2026-08-13 já o registrara como `LEGACY_RETIREMENT` pendente. Marcar como aplicada seria registrar no ledger uma função que produção não tem. |
| Afirmação corrigida: `20260813050000` conteria um `cdb_save_my_picks` pré-cutover | **ERRO DE AUDITORIA, CORRIGIDO NO MESMO DIA** | Era verdade para a versão ORIGINAL do arquivo, e deixou de ser depois do rebase — a definição lê `bolao.cdb_authoritative_document()` desde então. A afirmação foi repetida do registro de 2026-08-13 sem reconferir o arquivo atual, e chegou a entrar no corpo do PR #128. Medido e corrigido comparando o código dos dois arquivos. Lição registrada em `LESSONS_LEARNED.md`: registro de auditoria anterior é ponto de partida, nunca prova do estado atual — a ordem de fonte de verdade deste repositório já dizia isso. |
| Deploy das quatro migrações | **APLICADO 2026-08-16** | `db push --linked --include-all` depois do dry-run limpo (`OLD_UNRELATED_PENDING_MIGRATIONS = 0`, `ROLLBACK_FILES_DISCOVERED = 0`). Trajetória do ruído: 17 arquivos → 5 (rollbacks movidos) → 4 (`050000` aposentada). `--include-all` foi necessário porque `20260813040000` ordena antes da última migração remota, e o conjunto resultante foi exatamente o aprovado. `migration repair` não usado; histórico remoto não reescrito. Pós-deploy: projeção 12/12 igual ao autoritativo, 5 com campeão, 7 incompletas, `FABRICATED_PICKS = 0`, `PARTICIPANT_PICKS_MUTATED = 0`. |

## Nota manual — Powerball entra na cobertura do checador visual (2026-08-20, Issue #194)

Até hoje `audit_visual_consistency.mjs` comparava **três** apps. O Powerball nunca esteve nele, então
**"0 divergências" nunca incluiu o Powerball** — a mesma forma do falso-verde da Issue #217, onde a
ferramenta reportava consistência sobre um escopo menor do que o anunciado.

O app agora é medido de verdade: 30 componentes com seletor próprio (ou `null` explícito e
justificado, quando o componente genuinamente não existe numa página única sem abas, sem idiomas,
sem formulário de entrada e sem admin). Das 25 diferenças originalmente medidas contra a Copa,
**23 já eram duplicação e foram corrigidas antes desta mudança**; as duas restantes eram decisões de
produto e foram ratificadas por Eduardo em 2026-08-20.

| Divergência | Classificação | Motivo |
|---|---|---|
| Cabeçalho do Powerball tem 64,5px contra 108,5px dos três bolões (`topbar:height`, `topbar:gridTemplateColumns`) | **INTENTIONALLY_DIFFERENT — ratificado por Eduardo 2026-08-20** | É a **mesma barra com menos itens dentro**, não uma barra estilizada diferente. Os bolões de futebol têm uma linha de abas (Ranking/Jogos/Regras/Palpites) e uma linha de botões de idioma; o Powerball é página única, num idioma só, e não tem nenhuma das duas — a coluna correspondente do grid mede literalmente `0px`. Fundo, borda, `padding`, `gap`, sticky, blur, marca, botão do WhatsApp e seletor de sorteio já batem **exatamente** com os outros três, no desktop e no celular. Igualar as alturas exigiria inventar uma linha de abas que não navega para lugar nenhum, ou empurrar espaço vazio no cabeçalho: as duas pioram a página para produzir um número igual num relatório. |
| Powerball tem 60px a mais de respiro no rodapé (`main:padding` = `20px 18px 60px` contra `20px 18px`) | **INTENTIONALLY_DIFFERENT — ratificado por Eduardo 2026-08-20** | Os apps de futebol trocam de seção por abas, então cada tela é curta e termina quando o usuário troca de aba. O Powerball é uma rolagem única e longa (resumo, participantes, tickets, resultado) e sem esse respiro o último cartão encosta na borda de baixo da tela. Remover não deixa nada mais consistente para quem usa — deixa o fim da página apertado num app e não muda absolutamente nada nos outros três. Os dois primeiros valores são **idênticos** aos dos outros três; a diferença é exclusivamente o terceiro. |

**As duas estão registradas na `ALLOWLIST.json` como `expectedType: "exact"`, com o valor fixado por
app** — não como uma permissão genérica de "o cabeçalho pode diferir". Provado por mutação: subir o
`padding-top` do `.topbar` do Powerball leva `topbar:height` de `64.5px` para `84.5px`, a entrada
para de casar e o gate reprova. Uma regressão visual não-ratificada também reprova: um
`border-radius`/`background` sintético no cartão do Powerball produziu duas DIVERGENTES imediatas.

Duas correções de harness feitas junto, ambas artefato de seletor e não diferença de design:
`card-base` passou a usar `section[class="card"]` (a primeira versão usava `.card` e pegava
`.card.pb-hero`, com fundo transparente e cor própria, gerando três DIVERGENTES falsas); e `h2` ficou
`null` no Powerball porque o primeiro `h2` dos três bolões está numa **seção oculta**
(`getComputedStyle` devolve `height:auto` para elemento não renderizado) enquanto o do Powerball está
visível — comparar os dois mediria visibilidade, não token de tipografia.

`main:height` e `card-base:height` passaram a cobrir os quatro apps: são `content-driven` no Powerball
pelo mesmo motivo que nos outros três. Não é exceção nova — é a mesma exceção aplicada ao app que
antes nem era medido.
