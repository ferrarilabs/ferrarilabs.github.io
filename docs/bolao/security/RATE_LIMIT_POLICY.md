# Rate Limit Policy — Plataforma Bolão

2026-08-02. Método: leitura de código (`adminMaxAttempts`/`adminLockMinutes` em `config.js`,
`limitRateMs` no bloco `emailjs`, `pollIntervalMs` no ESPN, debounce em `saveState()`) — nenhuma
carga real foi gerada contra produção.

**Regra de classificação usada abaixo (do próprio task):** debounce/throttle/botão desabilitado
no JS = sempre `CLIENT_SIDE ONLY` — **não é controle contra um atacante**, só reduz abuso
acidental de um usuário legítimo (ex.: duplo-clique).

## Matriz

| Operação | Ator | Limite atual | Janela | Chave do limite | Resposta 429 | Retry-After | Controle real? | Risco |
|---|---|---|---|---|---|---|---|---|
| Login admin (tentativa de senha) | Qualquer visitante | 5 tentativas → bloqueio | 15 min (`adminLockMinutes`) | `sessionStorage["adminLockUntil"]` (Copa) / `sessionStorage["br2026_loginLockUntil"]` / `sessionStorage["cdb2026_loginLockUntil"]` | Nenhum HTTP 429 real — é só um `if` no JS que impede o próximo clique | N/A | **CLIENT_SIDE ONLY** | Alto — `sessionStorage` é por aba/sessão; fechar a aba (ou abrir uma nova) reseta o contador para 5 tentativas novas. O hash SHA-256 em si (`adminPasswordHash`) está sempre público no `config.js`, então um atacante nem precisa do lockout: pode testar offline (dictionary/rainbow table) sem limite algum — o lockout só afeta quem tenta via UI |
| Criação/edição de entrada (participante) | Participante | Nenhum | — | — | — | — | **AUSENTE** | Médio — nada impede um script enviar centenas de "entradas" via `POST` direto ao Supabase com a chave anon pública, sujeitas só ao limite de tamanho da linha (1 MB) |
| Salvamento remoto (`saveState`/`saveRemoteState`) | App (qualquer usuário) | Debounce de 400ms | Por chamada | Em memória (JS `setTimeout`), não persistido | — | — | **CLIENT_SIDE ONLY** | Baixo-médio — reduz escrita acidental repetida do mesmo navegador, não impede um script external chamando a API diretamente em qualquer frequência |
| EmailJS (envio de e-mail) | App (participante ou script admin) | 1 e-mail / 30s (`limitRateMs: 30000`) | Por sessão de navegador (SDK do EmailJS, client-side) | Estado interno do SDK EmailJS, não persistido entre reloads | Erro do SDK, tratado no app | N/A | **CLIENT_SIDE ONLY** (mas ver nota "Provider" abaixo) | Médio — reload da página ou nova aba reseta o throttle; **porém** o EmailJS *provedor* também tem seus próprios limites de plano (quota mensal), que são a única proteção real contra esgotamento total — não verificável a partir do código deste repo (é uma configuração de conta no dashboard do EmailJS, fora deste repositório) |
| Polling ESPN (BR2026) | App (todo visitante ativo) | `pollIntervalMs: 60000` (60s), com backoff em falha e pausa quando `document.hidden` (desde v1.23) | 60s por aba ativa | Em memória, `setTimeout` autorreagendado | N/A (API pública sem limite conhecido) | N/A | **CLIENT_SIDE ONLY**, mas bem comportado (evita poll agressivo, pausa em background) | Baixo — não é uma defesa contra abuso deliberado, mas reduz carga incidental razoavelmente bem |
| Sync ESPN (Copa/CDB2026, admin-triggered ou cron) | Admin / GitHub Actions cron | Cron a cada 10 min (Copa/CDB2026) ou 30 min (BR2026 round emails) | Fixo, definido no `.yml` | N/A (execução agendada, não por usuário) | N/A | N/A | **SERVER_SIDE ENFORCED** (é o próprio agendador do GitHub Actions, não um rate limit contra abuso, mas efetivamente limita a frequência de chamadas externas) | Baixo |
| Brute force da senha admin | Atacante | Ver linha "Login admin" acima | — | — | — | — | **CLIENT_SIDE ONLY** (na prática, **AUSENTE** para quem ataca offline o hash já público) | Alto — mitigado apenas pela expectativa de que ninguém terá motivo real para atacar um bolão informal; não é uma defesa técnica |
| Enumeração de IDs (`bolao_state.id`) | Qualquer um com a chave anon | Nenhum | — | — | — | — | **AUSENTE** — mas o espaço de enumeração é trivial mesmo sem rate limit (só 3 ids conhecidos e documentados publicamente na arquitetura, ver `ENUMERATION_REVIEW.md`) | Baixo (não há segredo para enumerar — os 3 ids já são conhecidos por design) |
| Download repetido de "backup" (export CSV/JSON) | Admin (via UI) ou qualquer um com a chave anon (via API direta) | Nenhum a nível de banco — a UI só permite via botão admin gated, mas a API subjacente (`select=*`) não tem limite | — | — | — | — | **AUSENTE a nível de API**; **CLIENT_SIDE ONLY** a nível de UI (`guardAdmin()`) | Médio — qualquer um pode "exportar" repetidamente via API direta sem precisar da senha admin, já que o dado está publicamente legível de qualquer forma (ver `SUPABASE_SECURITY_REVIEW.md`) |
| Abuso do formulário de contato (site principal, fora do bolão) | Qualquer visitante | Cloudflare Turnstile (challenge) + Formspree (limite de plano) | Por submissão | N/A | Depende do Formspree | N/A | **PROVIDER ENFORCED** (Turnstile + Formspree) | Baixo — este é o único fluxo da plataforma com uma proteção real de terceiro contra automação |

## Supabase Auth rate limits

Não aplicável — nenhum dos 3 apps usa Supabase Auth (confirmado por busca de código, nenhuma
chamada `supabase.auth.*`). Os limites nativos de rate limiting do Supabase Auth (login,
signup, OTP) não têm nenhum efeito aqui porque essa superfície nunca é exercitada pela
plataforma.

## Data API — proteção contra leitura em massa / paginação / enumeração / polling excessivo

- **Paginação sem limite**: `select=*` sem `limit` retorna a linha inteira (até 1 MB, pelo
  `check` de tabela) — não há paginação porque não há necessidade (é uma linha só por app). Não
  há proteção contra um cliente pedir repetidamente a mesma linha em loop — nenhum rate limit do
  lado da aplicação; qualquer limite existente viria só do próprio Supabase (nível de
  infraestrutura/plano, não verificável a partir deste repo sem acesso ao dashboard).
- **Mutações repetidas**: mesma observação — nenhum rate limit de aplicação sobre `insert`/
  `update`, só o `check` de tamanho de linha.
- **Sem gateway/função server-side**, então não há ponto central para aplicar rate limiting real
  além do que a própria Supabase oferece na borda do projeto (não avaliável sem dashboard).

## Conclusão

Todo controle de "rate limit" hoje na plataforma é **CLIENT_SIDE ONLY**, exceto o agendamento
fixo dos GitHub Actions crons (que é mais um limite operacional do que uma defesa de segurança) e
o Cloudflare Turnstile/Formspree do site principal (não-bolão). Nenhum controle listado aqui
resiste a um atacante que ignore o `app.js` e chame a API diretamente — que é exatamente o método
usado (só leitura) por esta própria auditoria. Nenhuma mudança foi implementada; ver
`SECURITY_BASELINE_FOR_FUTURE_POOLS.md` para requisitos mínimos recomendados a futuros bolões.
