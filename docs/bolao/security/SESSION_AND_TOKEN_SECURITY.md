# Session, JWT, and Token Security — Plataforma Bolão

2026-08-02. Método: leitura de código (`guardAdmin()`, `adminLogin()`, `sessionStorage`/
`localStorage` usage nos 3 `js/app.js`, `scripts/*.py`). Confirmado por busca: **nenhum dos 3
apps usa Supabase Auth, JWT de usuário, ou cookie de sessão de aplicação.**

## O que existe de verdade

| Mecanismo | Onde | Duração | Armazenamento | Observação |
|---|---|---|---|---|
| Senha admin (hash SHA-256, comparação client-side) | `config.adminPasswordHash`, comparado em `adminLogin()` | N/A (não expira, é um hash estático até ser trocado manualmente) | Hash em `config.js` (público, versionado); nunca a senha em texto puro | **Mesmo hash nos 3 apps** — comprometer uma credencial compromete os 3 painéis (`CONSISTENCY_MATRIX.md` item 2, decisão consciente) |
| Sessão admin ativa | `sessionStorage["adminOk"]` + `sessionStorage["adminUntil"]` (Copa); `sessionStorage["br2026_adminUntil"]`/`sessionStorage["cdb2026_adminUntil"]` (BR2026/CDB2026, prefixo por app) | 30 min (`adminSessionMinutes`), estendida a cada render admin bem-sucedido (`extendAdmin()`) | `sessionStorage` — limpo ao fechar a aba | `guardAdmin()` chamado em **toda** ação admin, não só no login — uma sessão expirada não executa nenhuma ação |
| Lockout de tentativas | `sessionStorage["adminLockUntil"]` (Copa) / `sessionStorage["br2026_loginLockUntil"]` / `sessionStorage["cdb2026_loginLockUntil"]` | 15 min (`adminLockMinutes`) após 5 tentativas | `sessionStorage` — **resetado ao fechar a aba** | Consistente nos 3 apps (mesmo mecanismo); `docs/bolao/SECURITY.md`/`ARCHITECTURE.md` descrevem incorretamente como `localStorage` — divergência de documentação já catalogada em `CONSISTENCY_MATRIX.md` item 3, não corrigida aqui (fora do escopo desta auditoria, que é somente leitura) |
| Draft de formulário (não-admin) | `sessionStorage["bolao_draft_v4"]` (Copa; nomes próprios equivalentes em BR2026/CDB2026) | 2 horas, checado por timestamp `ts` | `sessionStorage` | Não é um mecanismo de autenticação — só evita perda de rascunho do formulário |
| Chave anon do Supabase / chave pública do EmailJS | `config.js` | Não expira (não é um token de sessão, é uma credencial estática de API pública) | Código-fonte versionado (público por design) | Não é comparável a um JWT de usuário — é uma chave de API compartilhada por toda a aplicação, nunca por-usuário |
| Automação Python (`scripts/*.py`) | Nenhuma sessão — cada execução usa a mesma chave anon estática lida do topo do arquivo (`SUPABASE_ANON = "sb_publishable_..."`, hardcoded) | N/A | Hardcoded no `.py`, versionado no repo (mesma chave já pública no navegador) | Nota importante: os scripts que rodam via GitHub Actions cron **autenticam como o mesmo papel `anon`** que qualquer navegador — não existe uma chave "de serviço" separada para automação. Isso significa que a automação de resultado/e-mail não tem mais privilégio, ao nível de banco, do que qualquer visitante do site — a única coisa que garante que só a automação legítima escreve resultados é que só ela (e o admin via UI) *tenta* fazer essas chamadas. RLS não distingue "GitHub Actions bot" de "browser de um participante curioso". |

## Supabase Auth — não utilizado (confirmado, não presumido)

Busca em `bolao/copa2026/js/app.js`, `bolao/br2026/js/app.js`, `bolao/cdb2026/js/app.js` por
`supabase.auth`, `signIn`, `signUp`, `onAuthStateChange`: **nenhuma ocorrência**. O SDK
`@supabase/supabase-js@2` é carregado (via CDN, com SRI) só para `createClient()` + chamadas REST
(`.from("bolao_state").select()/.upsert()`), nunca para autenticação.

Como consequência, todas as subseções abaixo — pedidas explicitamente pela tarefa — são marcadas
**NÃO APLICÁVEL AO MODELO ATUAL / REQUISITO OBRIGATÓRIO PARA FUTURA AUTENTICAÇÃO**. Não foi
inventado nenhum teste de JWT para um sistema que não usa JWT.

| Conceito (caso Supabase Auth fosse adotado) | Status hoje | O que precisaria existir numa futura arquitetura com Auth real |
|---|---|---|
| Emissão de token (login gera JWT) | NÃO APLICÁVEL — não há login de usuário, só comparação de hash client-side | Login real via Supabase Auth (email+senha, magic link, ou OAuth) emitindo um JWT de curta duração |
| Refresh token / rotação | NÃO APLICÁVEL | Refresh token com rotação a cada uso, revogação em logout |
| Expiração de token (TTL) | NÃO APLICÁVEL (a "sessão" admin de 30 min é um timestamp em `sessionStorage`, não um JWT com `exp`) | TTL curto no access token (ex. 15-60 min), refresh token com TTL maior |
| Revogação de sessão | NÃO APLICÁVEL — não há conceito de "revogar" além de limpar `sessionStorage` manualmente (o que o próprio usuário controla) | Endpoint de logout que invalida o refresh token no servidor, não só limpa storage local |
| Sessão revogada mas token ainda aceito | NÃO APLICÁVEL (não há token) | Testar que um JWT revogado é rejeitado nas próximas chamadas — requer RLS/claims reais |
| Token em localStorage exposto a XSS | Parcialmente aplicável — a sessão admin fica em `sessionStorage`, não `localStorage`; ver abaixo | Se adotado, preferir cookies `httpOnly`/`Secure`/`SameSite=Strict` sobre `localStorage`/`sessionStorage` para reduzir exposição a XSS |

## Exposição a XSS da sessão admin atual

Cross-referência com `docs/bolao/security/INJECTION_REVIEW.md` (seção DOM XSS): **nenhum sink de
XSS ativo foi confirmado nos 3 apps de dinheiro real** (`escapeHtml()`/`esc()` cobre todo caminho
dado→DOM identificado). Isso significa que, hoje, `sessionStorage["adminOk"]`/`adminUntil` **não
tem um vetor de exfiltração conhecido** via XSS nesta auditoria. Se um sink de XSS fosse
introduzido no futuro (ex. um novo `innerHTML` sem `escapeHtml`), a sessão admin seria imediatamente
sequestrável — `sessionStorage` é acessível a qualquer script rodando na mesma origem, sem
proteção adicional (não há `httpOnly` possível para `sessionStorage`, ao contrário de cookies).
Isso é uma razão adicional (além de XSS/roubo de dados) para manter a disciplina de escaping
verificada nesta auditoria.

## Operações que deveriam exigir reautenticação/maior assurance numa futura arquitetura com Auth real

Lista de referência (nenhuma implementada, é um requisito para quando Supabase Auth for
adotado — ver `docs/bolao/adr/ADR-006-supabase-rls-hardening-and-future-architecture.md`):

- Alterar resultado oficial de uma partida/confronto.
- Alterar status de pagamento.
- Excluir entrada de participante.
- Mudar regra de pontuação/bônus.
- Exportar dados privados (backup completo, CSV/JSON com PII).
- Restaurar um backup (sobrescrever o estado atual).
- Modificar policies de RLS.
- Alterar usuários/promover um novo admin.

## Conclusão

O modelo real da plataforma é: **nenhuma autenticação de usuário, uma senha admin client-side
compartilhada entre 3 apps, e sessão/lockout em `sessionStorage` com TTL curto**. Isso é
consistente com o que `SECURITY.md`/`PROJECT_MEMORY.md` já descrevem como decisão aceita para um
app informal — esta seção não encontrou nada além do já documentado, mas fecha a lacuna de nunca
ter sido escrito como um documento dedicado de sessão/token, e confirma explicitamente (por busca
de código, não suposição) a ausência de Supabase Auth/JWT em toda a plataforma.
