# HERO AO VIVO SUMIU — DIAGNÓSTICO EM MENOS DE 2 MINUTOS

Escrito depois de o hero sumir **quatro vezes por quatro causas diferentes**. Cada uma custou uma
investigação do zero porque não havia como saber, olhando a tela, qual camada tinha falhado.

**Comece pelo passo 1.** A primeira resposta já elimina metade das causas.

---

## 1. Abra o console e leia o diagnóstico (5 segundos)

```js
window.__BOLAO_LIVE_HEALTH__
```

| O que você vê | Significa | Vá para |
|---|---|---|
| `gateway.status: "OK"` e `ageSeconds < 30` | infraestrutura saudável | **passo 5** (é da aplicação) |
| `gateway.status: "UNREACHABLE"` | o gateway não respondeu | **passo 2** |
| `gateway.status: "STALE"` | o gateway respondeu com dado velho | **passo 3** |
| `source: "snapshot"` | caiu para o fallback | **passo 2** |
| `undefined` | o app não carregou o módulo | **passo 6** |

---

## 2. O gateway está de pé?

```bash
curl -s -w "\nHTTP=%{http_code} %{time_total}s\n" \
  "https://cmhqkkfczotdnssupkni.supabase.co/functions/v1/live-football?competition=br2026" | tail -5
```

- **HTTP 200** → o gateway está bem; o problema é do navegador → **passo 5**
- **HTTP 503** → a ESPN falhou E não havia cache utilizável → **passo 3**
- **HTTP 404** → a função foi removida do projeto → reimplantar
- **timeout / conexão recusada** → indisponibilidade do Supabase; o app cai para o snapshot sozinho

---

## 3. A ESPN está respondendo?

```bash
curl -s -o /dev/null -w "ESPN HTTP=%{http_code}\n" \
  "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard"
```

- **200** → a fonte está boa; o problema é do cache ou da normalização
- **403 / 429** → bloqueio ou limite de taxa; o gateway serve o último-bom-conhecido por até 10 min
- **5xx** → indisponibilidade da ESPN; nada a fazer além de esperar; o app segue exibindo o último confirmado

O campo `staleReason` da resposta do gateway diz exatamente qual foi (`UPSTREAM_429`, `UPSTREAM_UNREACHABLE`…).

---

## 4. O cache compartilhado tem dado?

```bash
curl -s "https://cmhqkkfczotdnssupkni.supabase.co/rest/v1/live_sports_cache?competition=eq.br2026&select=observed_at,stored_at" \
  -H "apikey: <anon key de bolao/br2026/js/config.js>" \
  -H "Authorization: Bearer <a mesma>"
```

Vazio = nunca houve observação boa. `stored_at` antigo = a fonte está falhando há tempo.

---

## 5. O navegador está buscando?

```js
// há polling ativo?
window.__BOLAO_LIVE_HEALTH__.polling ?? "(ver aba Network: requisições a /live-football)"

// qual o estado do hero e por quê?
document.getElementById("liveMatchCard")?.dataset
// → heroState, heroReason, heroRetained, heroMatchId
```

| `heroState` | Leitura |
|---|---|
| `LIVE_CONFIRMED` | tudo certo — se o card não aparece, é CSS, não dado |
| `LIVE_RETAINED` | a fonte falhou e o último confirmado está no ar (correto) |
| `UNKNOWN` + `reason: RETENTION_EXPIRED` | passou de 15 min sem observação; degradou de propósito |
| `SOURCE_UNAVAILABLE` | nunca houve confirmação E a fonte está fora |

**Nunca** interprete ausência de card como "não há jogo" sem antes conferir `heroReason`.

---

## 6. Erros de rede ou CSP

Console → procure `Content Security Policy` ou `Failed to fetch`.

O `connect-src` precisa conter `https://*.supabase.co`. **A ESPN não deve estar lá** — se
aparecer, alguém reintroduziu chamada direta do navegador, o que é proibido por contrato e tem
gate próprio (`audit_live_decision_scope.mjs`).

---

## 7. Idade do snapshot commitado (só se `source: "snapshot"`)

```bash
curl -s "https://www.ferrarilabs.com/bolao/br2026/data/espn-normalized.json" | python3 -c "
import json,sys,datetime
d=json.load(sys.stdin); g=datetime.datetime.fromisoformat(d['generatedAt'].replace('Z','+00:00'))
print('idade:', round((datetime.datetime.now(datetime.timezone.utc)-g).total_seconds()/60), 'min')"
```

Snapshot velho **não é mais** causa de hero ausente — desde o LIVE DATA PLANE V2 ele é apenas
bootstrap. Se o app está nele, o gateway falhou; volte ao passo 2.

Contexto histórico: o cron do GitHub entrega intervalos de **24 a 47 minutos** apesar de declarar
dez. Isso é comportamento da plataforma e foi a razão de o gateway existir.

---

## As quatro causas históricas, e como cada uma se apresenta hoje

| Causa | Sintoma no diagnóstico |
|---|---|
| workflow escrevia sem commitar | `source: "snapshot"` com idade alta |
| cron cego 06:00–16:00 UTC | idem |
| mensagem de atraso substituía o minuto | `heroState: LIVE_RETAINED` com relógio visível (corrigido) |
| observação atual como única verdade | `heroReason` explica; o card não some mais |

## Reversão de emergência

`liveGateway.enabled: false` em `bolao/<app>/js/config.js` derruba tudo para o snapshot
commitado. Uma linha, sem alterar código.
