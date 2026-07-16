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

**Deliberadamente NÃO tocados**, por já estarem registrados como decisão consciente e não bug:
#62 (`--red` diferente entre Copa e BR2026/CDB2026 — mudança visual isolada, não patch em lote) e
#78 (`.admin-row` lista densa vs. card — decisão de UX já documentada). Uma mudança em lote como
esta não é o contexto certo pra reabrir decisões já tomadas deliberadamente.

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
