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

## Resumo por severidade

| Severidade | Quantidade |
|---|---|
| Critical | 0 |
| High | 3 (itens 1, 8, 9, 10 — comprovantes contam como uma única causa raiz; item 1 ainda pendente, itens 8/9/10 parcialmente resolvidos — CDB2026 sim, BR2026 ainda não) |
| Medium | 10 (itens 34 e 35 saíram desta contagem — resolvidos em v1.14/v2.0) |
| Low | 14 |
| Sem severidade (CONSISTENT/INTENTIONALLY_DIFFERENT sem ação) | 33 |

## Resumo por status

| Status | Quantidade |
|---|---|
| CONSISTENT | 34 |
| INTENTIONALLY_DIFFERENT | 13 |
| MISSING | 0 |
| OUTDATED | 0 |
| NEEDS_REVIEW | 13 |
| CRITICAL_DIVERGENCE | 0 |

### Progresso desta sessão (2026-07-12, mesma sessão do PROJECT_MEMORY/LESSONS_LEARNED)

Itens resolvidos no CDB2026 (v2.0) e/ou BR2026 (v1.14): 7 (parcial), 8/9/10 (parcial), 14
(parcial), 16 (parcial), 34 (total), 35 (total), 36 (parcial). Nenhum `MISSING`/`OUTDATED`
restante — tudo que não foi 100% resolvido virou `NEEDS_REVIEW` porque CDB2026 e BR2026 agora
divergem entre si (um resolvido, o outro não), não porque a auditoria não sabe o que fazer.
Pendência de maior risco ainda aberta: item 1 (sem `audit_scoring.py` equivalente para
BR2026/CDB2026, apesar de o CDB2026 ter ganhado uma fórmula de scoring nova e mais complexa
nesta mesma sessão — ver `bolao/cdb2026/CHANGELOG.md` v2.0).
<!-- AUTO:CONSISTENCY_MATRIX:END -->
