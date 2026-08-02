# Visual Parity Matrix — Plataforma Bolão

Matriz de paridade visual componente-a-componente entre os três aplicativos, produzida na
FASE 2.2 (auditoria visual/UX, 2026-08-02). Complementa `docs/bolao/CONSISTENCY_MATRIX.md`
(que cobre paridade **funcional** em granularidade de item de auditoria) — este documento
cobre paridade **visual/de componente**, no formato pedido pela tarefa original. Cross-link:
qualquer achado aqui que resolva/altere uma divergência já rastreada em `CONSISTENCY_MATRIX.md`
deve ser refletido lá também (feito nesta rodada onde aplicável — ver notas de rodapé).

**Método usado nesta rodada:** leitura direta de código (`css/styles.css`, `index.html`,
`js/app.js`) dos três apps, comparação lado a lado, e reconciliação com o histórico já
documentado em `docs/bolao/DESIGN_SYSTEM.md` e `docs/bolao/PLATFORM_DESIGN_SYSTEM.md` (que já
cobrem uma auditoria quase completa deste mesmo escopo, em rodadas anteriores, até
2026-07-14). **Não foi possível** capturar screenshots ou `getComputedStyle` reais nesta
sessão — `node`/`npx` não estão instalados nesta máquina (`which node npx` retorna vazio;
busca em `find / -maxdepth 4 -iname node` também vazia), então o harness Playwright existente
(`bolao/cdb2026/scripts/visual/capture_evidence.mjs`) não pôde ser executado. Onde a evidência
de `docs/bolao/evidence/visual/` (capturada 2026-08-01) já cobre um componente e não há commit
posterior que o tenha tocado, ela foi usada como confirmação visual real; caso contrário, o
status abaixo vem de leitura de código, não de renderização.

Legenda de severidade: **P1** (prejudica profissionalismo/navegação/uso) · **P2**
(inconsistência visível relevante) · **P3** (ajuste menor).
Verificação: **[code]** = confirmado lendo CSS/JS/HTML atual nesta sessão · **[hist]** =
reconfirma achado já registrado em `DESIGN_SYSTEM.md`/`PLATFORM_DESIGN_SYSTEM.md`, não
re-lido byte-a-byte nesta sessão · **[shot]** = confirmado por screenshot real (evidência de
2026-08-01, ainda válida na data deste documento).

| Componente | Copa do Mundo | Brasileirão | Copa do Brasil | Diferença encontrada | Justificada? | Severidade | Ação |
|---|---|---|---|---|---|---|---|
| Página geral / `main` max-width | `1140px`, padding `20px 18px` [code] | `1140px`, padding `16px 14px` [code] | `1140px`, padding `16px 14px` [code] | Nenhuma real — max-width idêntico; diferença de padding (4px/4px) documentada e decidida em 2026-07-16 (removida a folga de 80px que existia antes) | Sim — decisão registrada | — | Nenhuma |
| Cabeçalho / Topbar | referência, sticky, blur | idêntico [code] | idêntico [code] | Nenhuma | — | — | Nenhuma |
| Hero | Grid 2 colunas + card ao vivo | Hero simples + 2 cards irmãos | Hero simples, sem card ao vivo | Estrutural, mas por necessidade de dado (Copa/BR têm placar ao vivo, CDB não tem API externa) | Sim — `INTENTIONALLY_DIFFERENT` [hist] | — | Documentar (feito) |
| Tabs (nav principal) | 8 abas, `.nav button`, `min-height:44px`, `.active{background:var(--green)}` [code] | 9 abas, mesmo CSS, `grid-template-columns:repeat(9,...)` [code] | 6 abas, mesmo CSS, `repeat(6,...)` [code] | Nenhuma de componente — CSS idêntico; nº de colunas proporcional ao nº real de abas de cada app (correto, não drift) | Sim | — | Nenhuma |
| Estado ativo/hover/focus da tab | `.active`/`:hover{opacity:.88}`/`:focus-visible` | idêntico [code] | idêntico [code] | Nenhuma | — | — | Nenhuma |
| Navegação mobile (nav grid em telas estreitas) | `repeat(4,1fr)` <900px, `repeat(8,1fr)` 501-900px [code] | `repeat(3,1fr)` <900px [hist] | `repeat(3,1fr)` <900px [hist] | Contagem de colunas mobile diferente (4 vs 3) | Sim — BR2026 tem 9 abas/CDB2026 8, 3 colunas trunca menos texto; sinalizado ao Eduardo em 2026-07-14, sem reversão pedida | P3 | Manter — não igualar cegamente |
| aria-current / aria-selected nas tabs | Ausente [code] | Ausente [code] | Ausente [code] | Nenhuma — gap idêntico e compartilhado, nenhum dos três implementa | Não é uma divergência entre apps, mas é uma lacuna real de acessibilidade | P2 | Pendência de plataforma — requer tocar `showSection()`/troca de tab nos 3 apps, ver "Pendências" no relatório final |
| Título de seção (`.section-head h2`) | `22px`/`1.25rem`, `margin:0 0 4px` [code confirma unificado] | idêntico desde v4.131-round (2026-07-14) [hist] | idêntico [hist] | Nenhuma | — | — | Nenhuma |
| Texto auxiliar (`.muted`, subtítulo de seção) | `color:var(--muted)` | idêntico | idêntico | Nenhuma | — | — | Nenhuma |
| Formulário — label | uppercase, `var(--muted)`, `font-size:12px` | idêntico desde v4.126/v1.16/v2.2 [hist] | idêntico [hist] | Nenhuma | — | — | Nenhuma |
| Inputs | `bg3`, `radius:9px`, `padding:10px 12px`, foco `border-color` | idêntico [hist] | idêntico [hist] | Nenhuma | — | — | Nenhuma |
| Selects | `appearance:none`, mesmo padrão de input | idêntico [hist] | idêntico [hist] | Nenhuma | — | — | Nenhuma |
| Botão primário/secundário/destrutivo | Ver `DESIGN_SYSTEM.md` — byte-a-byte | idêntico [hist] | idêntico [hist] | Nenhuma | — | — | Nenhuma |
| Sticky submit (sombra/min-width) | `box-shadow:0 4px 24px rgba(47,229,110,.35)`, `min-width:200px` [code] | idêntico [code] | idêntico [code] | Nenhuma | — | — | Nenhuma |
| Cards de jogos (`.game-card`/`.match-card`) | referência | `.game-card` alinhado desde v1.19 [hist] | usa `.card` + `.confronto-card` (estrutura ida+volta) | Estrutura de card do CDB2026 é diferente (agrega duas pernas) | Sim — `TOURNAMENT_SPECIFIC` (mata-mata ida+volta sem equivalente na Copa) [hist] | — | Documentado |
| Status de jogo (chip ao vivo/final/pré/adiado) | `.status-chip.live/.done/.pending` | `.game-status.live/.post/.pre/.postponed` [code] | `.game-status` — adicionado 2026-08-02 (v3.74) trazendo chip/placar ao vivo/auto-scroll, paridade com Copa/BR2026 [code, commit ef7f2c4] | Nomes de classe diferentes por app (custo de renomear > benefício), paleta/formato já convergidos | Sim — `INTENTIONALLY_DIFFERENT` no nome da classe, visual convergido [hist+code] | — | Nenhuma — já corrigido nesta semana |
| Jogos ao vivo/finalizados/adiados | Copa: 4 estados | BR2026: 4 estados equivalentes | CDB2026: 4 estados equivalentes desde v3.74 | Nenhuma real remanescente | — | — | Nenhuma |
| Ranking — estrutura (`.rank-row`) | referência, grid `48px 1fr auto auto` | idêntico desde v1.17 [hist] | idêntico desde v2.3 [hist] | Nenhuma | — | — | Nenhuma |
| Posições empatadas / desempate (exibição) | ordem alfabética reversa para empate total | mesma regra de exibição, scoring próprio | mesma regra de exibição, scoring próprio | Fórmula de scoring é `TOURNAMENT_SPECIFIC` (não tocada) — só a exibição do empate segue o mesmo padrão visual | Sim | — | Nenhuma |
| Detalhes dos palpites (`.picks-detail`) | tabela expansível, `overflow-x:auto` | idêntico | idêntico, com destaque de linha por acerto/erro (2026-08-01, feature nova só do CDB2026) [hist] | CDB2026 tem um recurso a mais (highlight de linha) sem equivalente na Copa | Registrado como diferença não revertida — melhora sobre o baseline, não drift para pior | P3 | Avaliar propagar para Copa/BR2026 em rodada futura (não é regressão, é oportunidade) |
| Pagamento (`.pay-grid`) | 3 colunas, ícones reais (inclui Zelle) | idêntico desde correção do ícone Zelle quebrado (2026-07-14) [hist] | idêntico [hist] | Nenhuma | — | — | Nenhuma |
| Regras — estrutura de cards | 2 cards | 1 card único | 7 cards separados | Estrutura de agrupamento diverge nos três — conteúdo de cada um também diverge em volume | Parcialmente — CDB2026 tem mais conteúdo (exemplos ida/volta); mas o *padrão* de quantos cards diverge sem decisão editorial registrada | P3 | Pendência — decisão editorial do Eduardo necessária antes de reestruturar (`DESIGN_SYSTEM.md` já sinaliza isso, não implementado) |
| Probabilidades | Seção própria (Copa) | N/A — sem simulador equivalente | N/A | Feature exclusiva da Copa | Sim — `TOURNAMENT_SPECIFIC`/feature gap conhecido | — | Nenhuma |
| Modal | Nenhum app tem `<dialog>`/modal customizado — todos usam `confirm()`/`alert()` nativos | idêntico (ausência) | idêntico (ausência) | Nenhuma — consistente por ausência total | — | — | Nenhuma |
| Toast | `.bolao-toast` + `showToast()`, 4 variantes (success/error/warn/info) [code: 34 chamadas] | idêntico, `showToast()` presente (10 chamadas) [code] | idêntico, `showToast()` presente (21 chamadas) [code] | Nenhuma — já portado nos três | — | — | Nenhuma |
| Loading | Só texto estático (`"Carregando..."` no BR2026); Copa/CDB2026 não têm nem isso | Ausência consistente | Ausência consistente | Nenhum spinner/skeleton em nenhum app | Gap de plataforma, não divergência entre apps | P3 | Não implementado (feature nova, fora do escopo de "correção", ver `DESIGN_SYSTEM.md`) |
| Estado vazio | `<p class="muted">` idêntico texto/estrutura | idêntico | idêntico | Nenhuma | — | — | Nenhuma |
| Estado de erro | Sem componente dedicado — usa toast `.error`/`alert()` | idêntico | idêntico | Nenhuma | — | — | Nenhuma |
| Recibo/comprovante | `receiptHtml()`, Blob URL, tema claro | N/A — sem sistema de comprovante | N/A — sem sistema de comprovante | Feature ausente inteira em BR2026/CDB2026 | Gap conhecido de longa data (`PROJECT_MEMORY.md`, `CONSISTENCY_MATRIX.md`) | P2 (feature, não bug visual) | Fora do escopo desta fase (visual/estrutural) — feature grande, requer autorização separada |
| Admin — login | `#adminLogin` card, `<input type="password">`, `#adminLoginBtn` | markup idêntico [code] | markup idêntico [code] | Nenhuma | — | — | Nenhuma |
| Admin — navegação/subseções | Estrutura de card por subseção | idêntico em estrutura, menos subseções (feature gap, não visual) | idêntico em estrutura + subseção extra "Fases e confrontos" (`TOURNAMENT_SPECIFIC`) | Nenhuma de componente | — | — | Nenhuma |
| Admin — toolbar (densidade) | 13 ações | 2 ações | 4 ações | Diferença grande de nº de botões | Feature gap catalogado, não bug de componente (CSS do botão é idêntico) | Medium/feature | Não é alvo de padronização visual — ver `CONSISTENCY_MATRIX.md` item 6/10 |
| Admin — tabelas/formulários/filtros | `.admin-row`, `.admin-toolbar` | mesma classe/CSS | mesma classe/CSS | Nenhuma de componente | — | — | Nenhuma |
| Ações admin (cores primária/secundária/alerta/destrutiva) | `.small-btn`/`.danger` | idêntico | idêntico | Nenhuma | — | — | Nenhuma |
| Audit log | Copa tem relatório de auditoria publicado (trilíngue, v4.150) | Não tem equivalente | Não tem equivalente (registrado como dívida técnica: nenhum log de alterações admin) | Feature exclusiva da Copa | Sim — feature gap, não visual | — | Fora do escopo desta fase |
| Mobile / Tablet / Desktop (breakpoints) | `900px`/`500px`/`480px`/`901px` idênticos nos três [code confirma `.nav` grid muda nesses pontos nos 3 apps] | idêntico | idêntico | Nenhuma | — | — | Nenhuma |
| Tokens de cor `:root` | `--bg/--bg2/--bg3/--border/--border2/--green/--green-dk/--text/--muted/--danger-*/--gold/--red` | idênticos, incl. `--red:#ff6b6b` [code confirmado] | idênticos, incl. `--red:#ff6b6b` [code confirmado] | Nenhuma — unificado desde 2026-07-14 | — | — | Nenhuma |
| Tabela `.rules-table` — overflow mobile | Sem `overflow-x:auto` wrapper próprio (2 colunas curtas, não quebra na prática) | idêntico | idêntico | Nenhuma real — todos igualmente sem garantia estrutural | Não é uma divergência entre apps (mesmo nível de risco nos três) | P3 | Pendência de plataforma (não desta rodada) — ver relatório final |

---

## Notas de rodapé

- A linha "Status de jogo" reflete o trabalho mais recente da plataforma, concluído **hoje**
  antes desta auditoria (commit `ef7f2c4`, CDB2026 v3.74, "CDB2026: bring Jogos tab to parity
  with Copa/BR2026 — status chips, live score, auto-scroll"). Verificado nesta sessão que o
  código correspondente (`.game-status` em `bolao/cdb2026/js/app.js`, CSS em
  `bolao/cdb2026/css/styles.css:380`) está de fato presente e usa os mesmos tokens de cor
  (`var(--red)`) que Copa/BR2026.
- Nenhum item nesta matriz foi classificado **P1** — a auditoria não encontrou nenhuma
  divergência que hoje prejudique profissionalismo, navegação ou uso básico dos três apps.
  Isso é consistente com o histórico: rodadas anteriores (2026-07-12 a 2026-08-02) já
  resolveram os itens que originalmente seriam P1 (badge/status, ranking, tokens, ícone
  quebrado, folga de padding, tabs).
- Itens marcados P2/P3 sem ação nesta rodada estão listados na seção "Pendências" de
  `docs/bolao/VISUAL_STANDARDIZATION_REPORT.md`.
