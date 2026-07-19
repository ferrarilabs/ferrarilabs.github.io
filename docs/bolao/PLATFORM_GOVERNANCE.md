# Platform Governance — Plataforma Bolão

Conteúdo manual pode ser adicionado **fora** do bloco `AUTO:GOVERNANCE` abaixo — o bloco em
si é substituído inteiramente a cada auditoria de governança.

<!-- AUTO:GOVERNANCE:START -->
## Os três aplicativos

| App | Pasta | URL | Status |
|---|---|---|---|
| Copa do Mundo 2026 | `bolao/` | `ferrarilabs.github.io/bolao/` | **Em produção — dinheiro real em jogo** |
| Brasileirão 2026 | `bolao/br2026/` | `ferrarilabs.github.io/bolao/br2026/` | Não publicado (sem link do site principal) |
| Copa do Brasil 2026 | `bolao/cdb2026/` | `ferrarilabs.github.io/bolao/cdb2026/` | Publicado 2026-07-19, em produção (convite por e-mail; sem link do site principal pessoal) |

Os três são aplicativos **independentes** (sem imports/módulos compartilhados) que seguem o
mesmo padrão de arquivos (`index.html`, `css/styles.css`, `js/config.js`, `js/data.js`,
`js/i18n.js`, `js/app.js`) e o mesmo design system visual. Ver
`docs/bolao/CONSISTENCY_MATRIX.md` para o detalhamento área por área.

## Regra de propagação (obrigatória)

> Uma alteração visual, de componente, acessibilidade, segurança, banco, email, receipt,
> admin ou infraestrutura feita em um aplicativo deve ser auditada nos demais aplicativos
> antes do encerramento da tarefa.

Esta regra também está registrada em `CLAUDE.md`. "Auditada" significa, no mínimo: verificar
se a mesma mudança faz sentido nos outros dois apps, decidir se ela deve ser propagada agora
ou depois, e — se não for propagada — registrar o motivo (ver seção abaixo).

## Classificação das mudanças

Toda mudança relevante à plataforma deve ser classificada em uma destas categorias antes de
ser implementada:

| Categoria | Definição | Exemplos |
|---|---|---|
| `PLATFORM_SHARED` | Afeta o design system, um componente compartilhado, acessibilidade, ou um padrão de código usado nos três apps | Cor de botão, padding de card, função de escaping HTML, padrão de admin lockout |
| `TOURNAMENT_SPECIFIC` | Depende das regras do torneio específico e não deve ser generalizado | Fórmula de scoring, formato do bracket, badges de zona G4/Z4, texto de regras |
| `DATA_ONLY` | Só altera dados/conteúdo (times, datas, fixtures), sem tocar lógica ou UI | Atualizar `js/data.js` com resultado real, corrigir horário de um jogo |
| `SECURITY` | Afeta autenticação admin, CSP, exposição de chaves, XSS, ou qualquer superfície de ataque | Hash de senha, lockout, escaping, headers CSP |
| `EMERGENCY_HOTFIX` | Correção urgente para um bug que está afetando participantes agora, fora do ciclo normal de release | App fora do ar, cálculo de score incorreto detectado em produção |

## Regras de propagação e exceção

- **Correções compartilhadas devem ser propagadas quando fizer sentido.** Um bug de
  segurança ou de acessibilidade corrigido em um app quase sempre deve ser corrigido nos
  outros dois também — não é opcional por padrão, é a exceção que precisa de justificativa.
- **Diferenças específicas de torneio devem ser preservadas.** Não generalize fórmula de
  scoring, formato de bracket, ou textos de regras entre apps — cada torneio tem sua própria
  estrutura e isso é intencional (ver `CONSISTENCY_MATRIX.md`, coluna "Deve ser igual?").
- **Quando uma alteração não for propagada, o motivo deve ser registrado** — no changelog do
  app onde a mudança foi feita (`bolao/CHANGELOG.md`, `bolao/br2026/CHANGELOG.md` ou
  `bolao/cdb2026/CHANGELOG.md`) e, se for uma decisão de plataforma, também na coluna "Ação
  recomendada" da linha correspondente em `CONSISTENCY_MATRIX.md`.
- **Nunca alterar scoring ou regras de negócio sem autorização explícita** do Eduardo — isso
  vale para os três apps, não só para a Copa. BR2026 e CDB2026 também têm dinheiro real de
  entrada (US$5/entrada) mesmo antes de publicados.
- **O bolão da Copa está em produção e deve receber apenas patches pequenos, testados e
  reversíveis.** Não é o lugar para experimentar mudanças estruturais grandes.
- **Mudanças no bolão da Copa devem ser avaliadas nos outros dois apps** — mesmo que não
  sejam aplicadas imediatamente, a avaliação deve acontecer e ser registrada.
- **Mudanças nos outros dois apps não devem ser aplicadas automaticamente à Copa** sem
  avaliação de risco — BR2026 e CDB2026 são o lugar mais seguro para experimentar, exatamente
  porque não estão em produção. Uma mudança validada lá só vai para a Copa depois de avaliação
  explícita de risco, dado que a Copa já tem dinheiro real em jogo.

## Ordem recomendada de avaliação de risco por categoria

1. `SECURITY` e `EMERGENCY_HOTFIX` — mais urgentes, exigem avaliação nos três apps antes do
   encerramento da tarefa, independentemente de onde a mudança começou.
2. `PLATFORM_SHARED` — avaliar propagação, mas pode esperar o próximo ciclo de release se não
   for de segurança.
3. `TOURNAMENT_SPECIFIC` e `DATA_ONLY` — não propagar; apenas confirmar que a mudança não
   vazou acidentalmente para um componente compartilhado.

## Mandatory Audit Policy

- Alterações grandes exigem auditoria completa pré e pós-change (ver
  `docs/bolao/AUDIT_PROTOCOL.md` e o "Audit-first workflow" em
  `docs/bolao/ENGINEERING_STANDARD.md`).
- Alterações pequenas exigem auditoria direcionada ao escopo alterado.
- Mudanças em produção exigem rollback explícito.
- Scoring, ranking, resultados, banco e comprovantes exigem evidência de testes.
- Auditoria não equivale a autorização para alteração — findings são apresentados primeiro, a
  implementação só acontece com autorização explícita.
- Findings `Critical` podem receber recomendação de hotfix, mas ainda devem ser explicitamente
  apresentados antes de qualquer correção.
- Mudanças compartilhadas devem ser avaliadas nos três apps.
- A implementação deve preservar diferenças intencionais de cada torneio.
<!-- AUTO:GOVERNANCE:END -->
