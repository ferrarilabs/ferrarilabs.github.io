# CORS and Origin Policy — Plataforma Bolão

2026-08-02. Método: busca de código por `Access-Control-*`/CORS em `bolao/`, `.github/workflows/`,
docs (nenhum resultado — não há Edge Function, API própria, ou proxy neste repo); mais um teste
passivo real (GET/OPTIONS) contra o Supabase REST API público para documentar o comportamento de
CORS que a plataforma Supabase (não este repo) já aplica.

## Resumo executivo

**Este repositório não define nenhuma política de CORS própria** — é um site 100% estático
(GitHub Pages), sem Edge Function, sem API própria, sem proxy, sem servidor. Toda política de
CORS observável vem de serviços de terceiros (Supabase, GitHub Pages) e não é configurável a
partir deste repo. Marcado como **NÃO APLICÁVEL À IMPLEMENTAÇÃO ATUAL / OBRIGATÓRIO PARA FUTURAS
APIS** conforme pedido pela tarefa — mas o padrão abaixo fica documentado para reuso se este
repositório algum dia ganhar uma Edge Function/API própria.

**Lembrete obrigatório**: CORS é uma política aplicada pelo *navegador*, não é
autenticação/autorização. Um cliente HTTP direto (`curl`, um script Python, Postman) **ignora
CORS completamente** — é por isso que os scripts Python deste repo (`send_result_email.py`,
`backup.py`, etc.) conseguem chamar a mesma API Supabase sem jamais enviar um header `Origin` e
sem serem afetados por nenhuma política de CORS. Toda a proteção real contra escrita indevida (na
medida em que existe) vem de RLS, não de CORS — ver `docs/bolao/security/SUPABASE_SECURITY_REVIEW.md`.

## Domínios reais da plataforma (extraídos do repo, não inventados)

| Domínio | Papel |
|---|---|
| `ferrarilabs.github.io` | Domínio GitHub Pages original — ainda resolve (301 confirmado nesta auditoria) |
| `www.ferrarilabs.com` | Custom domain — destino do redirect 301 do GitHub Pages (confirmado via `curl -L` nesta auditoria) |
| `cmhqkkfczotdnssupkni.supabase.co` | Projeto Supabase (Data API) |
| `api.emailjs.com` | EmailJS |
| `site.api.espn.com` / `a.espncdn.com` / `sports.core.api.espn.com` | ESPN (não oficial) |
| `cdn.jsdelivr.net` | CDN dos SDKs EmailJS/Supabase |
| `gamma-api.polymarket.com`, `v3.football.api-sports.io`, `api.ipify.org` | Só Copa (opcional/desabilitado no caso da API-Football) |
| `data.ny.gov` | Loterias/Powerball |
| `formspree.io`, `challenges.cloudflare.com` | Site principal (fora do escopo bolão) |
| `localhost:8080` / `127.0.0.1:8080` | Ambiente de desenvolvimento local (`python3 -m http.server 8080`, documentado em `CLAUDE.md`) |
| `null`/`file://` | Não aplicável — o app nunca é aberto via `file://` em produção (CSP `default-src 'self'` já quebraria isso de qualquer forma) |
| Preview/staging | Não existe ambiente de preview/staging separado — só produção e `localhost` local |

## Endpoint | Ambiente | Origins permitidos | Credentials | Métodos | Headers | Preflight | Justificativa | Risco

| Endpoint | Ambiente | Origins permitidos | Credentials | Métodos | Headers | Preflight | Justificativa | Risco |
|---|---|---|---|---|---|---|---|---|
| Supabase Data API (`/rest/v1/bolao_state`) | Produção | **Qualquer origem é refletida** (ver teste abaixo) — não configurável a partir deste repo | Não (sem cookies de sessão de usuário nesta API — a única `Set-Cookie` observada é `__cf_bm`, um cookie anti-bot do Cloudflare, não credencial de app) | `GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS,TRACE,CONNECT` (todos refletidos no preflight) | `apikey,authorization` aceitos (e provavelmente qualquer um solicitado — não testado exaustivamente) | Sim, responde a `OPTIONS` com `Access-Control-Max-Age: 3600` | Comportamento padrão da plataforma Supabase para chaves públicas — a proteção real é RLS, não CORS (a chave é pública por design; qualquer origem "autorizada" por CORS ainda precisa passar pela mesma RLS que um `curl` sem `Origin` já passa) | **Baixo incrementalmente** — CORS aberto aqui não concede nada que a chave pública + RLS já não concedessem a um cliente sem navegador; risco real já está capturado em `SUPABASE_SECURITY_REVIEW.md`, não duplicado aqui |
| EmailJS (`api.emailjs.com`) | Produção | Não testado nesta auditoria (seria uma chamada de escrita/envio — fora do escopo somente-leitura) | Não (chave pública, sem cookie) | Presumivelmente `POST` para o endpoint de envio | N/A | Não verificado | EmailJS é desenhado para ser chamado direto do navegador com uma chave pública — CORS aberto é esperado do produto | Baixo — mitigado por rate limit (ver `RATE_LIMIT_POLICY.md`), não por CORS |
| ESPN (não oficial) | Produção | Não verificado formalmente, mas a API é consumida com sucesso por `fetch()` direto do navegador nos 3 apps sem erro de CORS relatado em nenhum changelog — implica CORS liberado do lado da ESPN | N/A (leitura pública) | `GET` | N/A | Não verificado | API pública não documentada oficialmente — fora do controle deste repo | Baixo (só leitura) |
| GitHub Pages (hosting estático) | Produção | `Access-Control-Allow-Origin: *` confirmado nesta auditoria (`curl -L` em `ferrarilabs.github.io/bolao/cdb2026/`) | Não | `GET` | N/A | N/A (recurso estático) | Comportamento padrão do GitHub Pages para todo conteúdo estático | Nenhum — não há dado sensível servido como asset estático, e não há cookie de sessão nesse domínio para um CORS aberto expor |
| Nenhuma Edge Function/API própria | — | — | — | — | — | — | Não existe no repo | N/A |

## Teste passivo real (2026-08-02)

```
GET /rest/v1/bolao_state?id=eq.main&select=id
Header enviado: Origin: https://evil-attacker-example.com
Resposta: access-control-allow-origin: https://evil-attacker-example.com
          access-control-expose-headers: Content-Encoding, Content-Location, Content-Range, ...

OPTIONS /rest/v1/bolao_state (preflight simulado)
Headers enviados: Origin: https://evil-attacker-example.com
                  Access-Control-Request-Method: PATCH
                  Access-Control-Request-Headers: apikey,authorization
Resposta: access-control-allow-origin: *
          access-control-allow-headers: apikey,authorization
          access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS,TRACE,CONNECT
          access-control-max-age: 3600
```

Confirma reflexão automática de qualquer `Origin` (equivalente, na prática, a `*`, já que não há
`Access-Control-Allow-Credentials: true` acompanhando — sem credentials, refletir o origin ou usar
`*` tem o mesmo efeito de segurança). **Nenhuma `Vary: Origin` foi observada** nas respostas —
consistente com o uso de wildcard efetivo, não um allowlist real por origem.

## Padrões inseguros procurados (nenhum encontrado neste repo, porque não há API própria)

`Access-Control-Allow-Origin: *` com credentials — N/A (nenhum código deste repo define isso).
Regex permissiva / `.endsWith()`/`.includes()` em domínio — N/A. Wildcard em subdomínio — N/A.
`allow_credentials=true` com wildcard — N/A. Ausência de `Vary: Origin` — observado no Supabase
(fora do controle deste repo), documentado acima.

## Padrão reutilizável para uma futura Edge Function/API própria

Se este repositório algum dia ganhar uma Edge Function/API própria (ex.: para implementar o RPC
de escrita gated proposto em `docs/bolao/adr/ADR-006-supabase-rls-hardening-and-future-architecture.md`),
o padrão recomendado é:

```
// Pseudocódigo — allowlist exata, nunca regex/endsWith/includes
const ALLOWED_ORIGINS = new Set([
  "https://www.ferrarilabs.com",
  "https://ferrarilabs.github.io",
  // adicionar "http://localhost:8080" só em modo dev, nunca em produção
]);

function corsHeaders(origin) {
  if (!ALLOWED_ORIGINS.has(origin)) return {}; // sem header = navegador bloqueia
  return {
    "Access-Control-Allow-Origin": origin,       // nunca "*" se credentials forem usadas
    "Vary": "Origin",                             // obrigatório ao refletir origin dinamicamente
    "Access-Control-Allow-Credentials": "false",  // esta plataforma não usa cookies de sessão
    "Access-Control-Allow-Methods": "GET, POST",  // só os métodos realmente necessários
    "Access-Control-Allow-Headers": "apikey, authorization, content-type",
    "Access-Control-Max-Age": "3600",
  };
}
```

Regra permanente: CORS nunca substitui autorização real no endpoint. Mesmo com um allowlist
exato, o endpoint ainda precisa validar RLS/RPC/claims — CORS só decide se o *navegador* de um
usuário legítimo pode fazer a chamada a partir daquela origem, nunca decide se a chamada em si é
permitida.
