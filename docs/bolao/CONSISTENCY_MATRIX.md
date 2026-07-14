# Consistency Matrix — Plataforma Bolão

Este arquivo é gerado/mantido por auditoria automatizada (ver `PLATFORM_GOVERNANCE.md`).
Conteúdo manual pode ser adicionado **fora** do bloco `AUTO:CONSISTENCY_MATRIX` abaixo —
o bloco em si é substituído inteiramente a cada auditoria.

<!-- AUTO:CONSISTENCY_MATRIX:START -->
## Snapshot da auditoria

Comparação feita entre os três aplicativos reais no estado de código correspondente a:

| App | Pasta | siteVersion | Status |
|---|---|---|---|
| Copa do Mundo 2026 | `bolao/` | v4.125 | **Em produção** |
| Brasileirão 2026 | `bolao/br2026/` | v1.14 | Não publicado |
| Copa do Brasil 2026 | `bolao/cdb2026/` | v2.0 | Não publicado |

Status possíveis: `CONSISTENT`, `INTENTIONALLY_DIFFERENT`, `MISSING`, `OUTDATED`, `NEEDS_REVIEW`, `CRITICAL_DIVERGENCE`.
Severidades: `Critical`, `High`, `Medium`, `Low`.

## Matriz

| # | Área/Feature | Copa do Mundo | BR2026 | CDB2026 | Deve ser igual? | Status | Divergência encontrada | Severidade | Ação recomendada |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Scoring self-audit script | `audit_scoring.py` valida bracket/scoring antes de cada envio | Nenhum script equivalente | Nenhum script equivalente | Sim (mesmo padrão de proteção) | NEEDS_REVIEW | BR2026/CDB2026 movimentam dinheiro real (US$5/entrada) mas não têm auditoria automatizada de scoring como a que evitou o incidente de julho/2026 na Copa | High | Antes de publicar BR2026/CDB2026, criar auditoria equivalente ou explicitamente documentar por que não é necessária |
| 2 | Admin password hash | `a6b9c8...138dee6` | mesmo hash | mesmo hash | Decisão do produto | INTENTIONALLY_DIFFERENT | Os três apps compartilham a mesma senha de admin — comprometer uma credencial compromete os três painéis | Medium | Registrar como decisão consciente; considerar hashes distintos por app antes de publicar os outros dois |
| 3 | Admin lockout (5 tentativas / 15 min) | `sessionStorage["adminLockUntil"]` | `sessionStorage["br2026_loginLockUntil"]` | `sessionStorage["cdb2026_loginLockUntil"]` | Sim | CONSISTENT | Implementação equivalente nos três; **porém** `docs/bolao/SECURITY.md` descreve o mecanismo da Copa como `localStorage`, o que não corresponde ao código atual (é `sessionStorage`) | Medium | Corrigir a descrição em `SECURITY.md` (fora do escopo desta tarefa — não foi alterado) |
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
| 21 | Supabase — `database.enabled` | `true` | `false` (aguardando criação da linha) | `false` (aguardando criação da linha) | Esperado dado que não estão publicados | INTENTIONALLY_DIFFERENT | — | — | Ativar (`true`) somente após criar a linha correspondente no Supabase e testar |
| 22 | Estratégia de merge (local-first) | `mergeStates()` — union de entries, local-wins em paid/results | `mergeStates()` equivalente | `mergeStates()` equivalente | Sim | CONSISTENT | Implementações independentes (copiadas), mas logicamente equivalentes | — | — |
| 23 | Sincronização multi-tab | `visibilitychange` **e** `focus` | apenas `visibilitychange` (dispara `checkVersion()`) | apenas `visibilitychange` (dispara `checkVersion()`) | Sim | NEEDS_REVIEW | BR2026/CDB2026 não re-sincronizam ao focar a aba, só ao trocar de visibilidade | Low | Adicionar listener de `focus` para paridade, se o padrão da Copa for considerado o correto |
| 24 | Live scores / API externa | ESPN (site/sports API) + API-Football (desabilitado) + Polymarket | ESPN (standings/scoreboard/schedule, poll 60s) | **Nenhuma API externa** — dados estáticos em `js/data.js` | Não necessariamente (depende do formato do torneio) | INTENTIONALLY_DIFFERENT | CDB2026 é mata-mata com poucos jogos; pode não precisar de polling ao vivo ainda | Low | Avaliar se Oitavas/Quartas/Semis precisarão de atualização ao vivo antes da publicação |
| 25 | Detecção de jogo adiado (postponed) | Implementado (`postponed` hint + i18n `matchPostponed`) | Implementado (`.game-status.postponed`, i18n `gamePostponed`) desde v1.13 | **Não implementado** — sem CSS, sem i18n, sem lógica | Sim, mata-mata é sensível a adiamentos | NEEDS_REVIEW | CDB2026 não tem nenhuma forma de sinalizar jogo adiado | Medium | Portar a lógica de BR2026 (v1.13) para CDB2026 antes de publicar |
| 26 | Cache de API externa | `localStorage["bolao_api_football_cache"]`, TTL 60min | cache implícito via poll 60s (não persistido) | N/A (sem API) | Não necessariamente | INTENTIONALLY_DIFFERENT | Estratégias diferentes por natureza da fonte de dados | — | — |
| 27 | Cutoff — enforcement | Client-side, `isPastCutoff()` | idêntico padrão | idêntico padrão | Sim | CONSISTENT | Nenhuma | — | — |
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
| 62 | Tokens de cor `--gold`/`--red` no `:root` | Não existiam (hex literal espalhado: `#f59e0b`, `#ff6b6b`) até v4.126; agora existem, `--red:#ff6b6b` | `--gold:#f59e0b`, `--red:#f87171` (já existiam) | idêntico ao BR2026 | Sim, todo app deveria ter os mesmos tokens de cor semântica | NEEDS_REVIEW | Tokens agora existem nos três, mas `--red` tem valor diferente entre a Copa (`#ff6b6b`, já usado ao vivo em produção) e BR2026/CDB2026 (`#f87171`) — não unificado de propósito, mudaria a cor renderizada em produção | Low | Decidir um valor único de `--red` só numa mudança visual deliberada, avaliando o impacto em produção — não como patch mínimo |
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
| 78 | `.admin-row` — lista vs. card | `<div class="card admin-entry">` — cada linha é um card completo | `.admin-row` — lista densa com `border-bottom`, não é card | `.admin-row` — idem BR2026 | Recomendado pela regra de referência canônica, mas admin tem densidade de dados maior (lista de entradas pode ser longa) e é área de baixa visibilidade (só o Eduardo usa) | NEEDS_REVIEW | **Não resolvido nesta rodada** — decisão consciente de manter lista densa em vez de virar N cards separados, dado o volume de linhas e o contexto admin-only; reavaliar se algum dia a lista de participantes crescer muito | Low | Se decidir padronizar, converter para `<div class="card admin-entry">` por linha, igual à Copa |
| 79 | Tabela do Brasileirão — colunas (BR2026 apenas) | N/A — Copa não tem tabela de classificação (torneio é mata-mata) | V/E/D/GP/GC/SG adicionados em v1.19 (só tinha Pos/Time/Pts) | N/A — CDB2026 não tem standings (sem API ao vivo) | Tournament-specific — não existe equivalente na Copa pra comparar | INTENTIONALLY_DIFFERENT | Resolvido como bug funcional (dado já vinha da ESPN, só não era exibido), não como divergência cross-app | — | — |

## Resumo por severidade

| Severidade | Quantidade |
|---|---|
| Critical | 0 |
| High | 3 (itens 1, 8/9/10 combinados) |
| Medium | 10 |
| Low | 16 (item 78/`.admin-row` entrou nesta rodada) |
| Sem severidade (CONSISTENT/INTENTIONALLY_DIFFERENT sem ação) | 50 |

## Resumo por status

| Status | Quantidade |
|---|---|
| CONSISTENT | 48 |
| INTENTIONALLY_DIFFERENT | 14 |
| MISSING | 0 |
| OUTDATED | 0 |
| NEEDS_REVIEW | 15 |
| CRITICAL_DIVERGENCE | 0 |

### Progresso — Copa como referência visual canônica (v4.128 / v1.19 / v2.5)

Itens resolvidos: 70 (`main` max-width), 71 (card de jogo no BR2026), 72 (grid time×placar no
BR2026), 73 (ícone no card de pagamento), 74 (`.pay-grid` 3 colunas), 75 (texto do botão
WhatsApp), 76 (spinner de input numérico), 77 (`.admin-toolbar` gap/margin). Item 78
(`.admin-row` vs. card por linha) fica registrado como `NEEDS_REVIEW`, decisão consciente de
não converter nesta rodada — ver a linha para o racional. Item 79 é uma correção funcional da
tabela do Brasileirão (dado que a ESPN já fornecia e não estava sendo exibido), não uma
divergência cross-app, classificado `INTENTIONALLY_DIFFERENT` porque a Copa não tem
equivalente (mata-mata não tem tabela de classificação).

Junto com bugs reais encontrados testando o CDB2026 ao vivo (não fazem parte da comparação com
a Copa, mas foram corrigidos na mesma leva): ordem de mandante/visitante no jogo de volta,
escudo faltando nas linhas de jogo individuais, card de edição de entrada não escondendo por
completo, layout do palpite por confronto reorganizado numa linha, e a automação da regra real
da CBF pra "quem avança" (trava em vitória simples, destrava em empate agregado).

### Progresso — patches mínimos do DESIGN_SYSTEM.md (v4.126 / v1.16 / v2.2)

Itens resolvidos nos três apps: 63 (input/select/label), 64 (h1/h2/h3), 65 (padding de
`.rules-table`), 66 (sombra/`min-width` do botão sticky). Item 62 (tokens `--gold`/`--red`)
parcialmente resolvido — tokens existem nos três, mas o valor de `--red` da Copa
(`#ff6b6b`, já em produção) não foi unificado com o de BR2026/CDB2026 (`#f87171`) por não ser
um patch mínimo (mudaria cor renderizada em produção).

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
