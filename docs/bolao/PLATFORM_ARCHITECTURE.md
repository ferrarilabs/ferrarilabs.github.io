# Platform Architecture — Bolão do Ferrari

Conteúdo manual pode ser adicionado **fora** do bloco `AUTO:PLATFORM_ARCHITECTURE` abaixo — o
bloco em si é substituído inteiramente a cada auditoria de arquitetura. Ver também
`docs/bolao/PLATFORM_DESIGN_SYSTEM.md`, `docs/bolao/PLATFORM_GOVERNANCE.md`,
`docs/bolao/CONSISTENCY_MATRIX.md`.

<!-- AUTO:PLATFORM_ARCHITECTURE:START -->
## Shared platform concerns

Devem ser avaliados (não necessariamente idênticos, mas comparados) nos três apps sempre que
alterados em qualquer um deles:

- **Visual components** — ver `docs/bolao/PLATFORM_DESIGN_SYSTEM.md` para tokens/componentes.
- **Buttons** — classes `.secondary`/`.danger`/`.small-btn`, estados hover/disabled/focus-visible.
- **Forms** — `label`/`input`/`select`, validação, grid de 2 colunas.
- **Accessibility** — `min-height:44px` em nav, `:focus-visible`, `aria-label`/`aria-live`.
- **Admin UX** — login/logout/lockout/sessão (`guardAdmin()`, `sha256hex()`), toolbar, ações
  destrutivas com `confirm()`.
- **Navigation** — `.nav`/`.topbar`, seção ativa, seletor de bolão, seletor de idioma.
- **Ranking shell** — `.rank-row` denso de 1 linha + `.picks-detail` expansível (`<table>`
  interna), independente do conteúdo específico do torneio.
- **Receipts** — `receiptHtml()`/`hashString()`/`receiptCode()` (padrão `{PREFIX}-XXXXXXXX-
  YYYYMMDD`), layout HTML tema claro compartilhado.
- **Emails** — EmailJS, envio duplo (participante + admin), throttle de 30s.
- **PDFs** — popup Blob URL + print (só a Copa implementa hoje; ver dívida técnica em
  `CONSISTENCY_MATRIX.md` item 9).
- **Error handling** — `alert()` para validação de formulário, `showToast()` para
  confirmação/erro não-bloqueante.
- **Loading** — troca de texto do botão (`"Salvando..."`) durante operação assíncrona.
- **Security patterns** — `escapeHtml()`/`esc()` em todo `innerHTML` com dado de usuário; CSP;
  SHA-256 admin auth; lockout; RLS Supabase por `id` de linha.
- **Sync patterns** — local-first (`localStorage` sempre grava primeiro), Supabase como espelho
  opcional (`saveState()` chama `saveRemoteState()` só se `database.enabled`), merge
  `preferRemoteResults:true`, polling em foco/visibilidade/`pageshow` (bfcache).
- **Storage boundaries** — uma chave de `localStorage` por app (`bolao_copa_2026_state`,
  `bolao_br2026_state`, `bolao_cdb2026_state`), uma linha por app na mesma tabela Supabase
  (`id = "main"/"br2026"/"cdb2026"`), nunca compartilhadas entre apps.
- **Responsive behavior** — breakpoints `900px`/`500px`/`480px`, sem overflow horizontal, alvo de
  toque mínimo 44px.

## Tournament-specific concerns

Devem permanecer isolados — **nunca generalizar entre apps**, mesmo quando parecem
estruturalmente parecidos:

### Copa (`bolao/`)

- Bracket fixo desde o deploy (`data.js`, `knockoutMatches`) — 32 partidas de mata-mata.
- Avanço decidido por `advanceSide` quando o placar empata (não há pênaltis no placar).
- Bônus campeão/vice/3º/4º lugar — só a Copa tem disputa de 3º lugar.
- Scoring por jogo: exato (10) / resultado certo (5) / um time certo (1).
- Prorrogação conta para o placar; pênaltis fora do placar.
- Cutoff único, estático, global (`cutoffIso`) — todo o bolão fecha de uma vez.

### BR2026 (`bolao/br2026/`)

- Não é mata-mata — palpite é sobre a classificação FINAL do Brasileirão (G4/SA6/Z4).
- "Projeção do Bolão": pontuação/posição exibida antes do fim da temporada é sempre projeção
  (`getActiveScore()` com `isOfficial:false`), nunca definitiva — ver
  `docs/bolao/BR2026_PROJECTION_MODEL.md`.
- Classificação ao vivo dos clubes (`calculateLiveStandings()`) — conceito totalmente distinto de
  movimento de participante no ranking (`calculateRankingMovement()`); nunca compartilham estado.
- Cutoff único, mas calculado dinamicamente (1h antes do primeiro jogo real, congelado uma vez em
  `s.cutoffAt` — ver `CONSISTENCY_MATRIX.md` nota de cutoff).

### CDB2026 (`bolao/cdb2026/`)

- Fases progressivas cadastradas incrementalmente pelo admin conforme sorteios reais acontecem
  (`DATA.phases`, sem bracket fixo em `data.js`).
- Formatos mistos: partida única (`SINGLE_MATCH`, fases 1-4 e final) e ida+volta (`TWO_LEG`, fase
  5, oitavas em diante).
- Agregado calculado automaticamente a partir das duas pernas — nunca digitado direto.
- Classificado decidido automaticamente quando o agregado não empata; manual/pênaltis quando
  empata sem sinal explícito de vencedor da ESPN — ver `CDB2026_RULES_AND_MODEL.md` §7.
- Cutoff por FASE (não um único global) — auto-calculado a partir do kickoff mais cedo conhecido
  da fase ativa; manual é só fallback sem kickoff conhecido (v3.18).
- Sincronização automática com ESPN (pareamento + resultado) — nenhum outro app tem isso.

## Propagation rules

Toda alteração em: CSS compartilhado; componente; botão; form; accessibility; admin; receipt;
email; PDF; ranking shell; loading; error; security; storage; infraestrutura — **deve ser
auditada nos outros dois apps antes de encerrar a tarefa** (mesma regra já existente em
`CLAUDE.md`/`PLATFORM_GOVERNANCE.md`).

Quando não for propagada:

- registrar o motivo;
- classificar como `INTENTIONALLY_DIFFERENT`;
- atualizar `docs/bolao/CONSISTENCY_MATRIX.md`;
- atualizar o `CHANGELOG.md` do(s) app(s) envolvido(s).
<!-- AUTO:PLATFORM_ARCHITECTURE:END -->
