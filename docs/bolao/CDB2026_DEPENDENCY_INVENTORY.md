# CDB2026 — Dependency Inventory

**Gerado:** 2026-08, Fase 2, item 16 (§21 do mega-prompt).
**Fonte:** leitura direta de `bolao/cdb2026/index.html` e `bolao/cdb2026/js/config.js`.

## Dependências de runtime (carregadas no navegador do participante)

| Dependência | Versão | Origem | Uso | Proteção |
|---|---|---|---|---|
| `@emailjs/browser` | `4` (tag major, sem pin de patch — ver nota) | `cdn.jsdelivr.net` | Envio de recibo (`sendReceipt()`) | SRI (`integrity="sha384-SALc35..."`) + `crossorigin="anonymous"` |
| `@supabase/supabase-js` | `2.45.4` (pinado) | `cdn.jsdelivr.net` | Não usado diretamente para queries — `app.js` fala com a REST API do Supabase via `fetch()` puro (`fetchJson()`), não via este SDK. Ver nota abaixo. | SRI (`integrity="sha384-GFr3yT..."`) + `crossorigin="anonymous"` |

**Nota — `@supabase/supabase-js` carregado mas não usado para as chamadas reais:**
Confirmado por leitura de `app.js`: `loadRemoteState()`/`saveRemoteState()` usam `fetchJson()`
(wrapper de `fetch()` puro) contra `${url}/rest/v1/${table}`, não `window.supabase.from(...)`.
O script do SDK é carregado no `<head>` mas nenhuma chamada a `window.supabase.*` foi encontrada
em `app.js`. Isto é uma dependência carregada sem uso confirmado — candidato a remoção, mas
**não removido nesta modernização** porque (a) remover um `<script>` do `<head>` sem certeza
absoluta de que nada mais depende dele (ex. algum outro app irmão compartilhando cache/config)
exige uma verificação cross-app que não foi feita, e (b) o mega-prompt pede para não misturar
limpeza com mudança de comportamento sem evidência completa — registrado aqui como achado para
decisão futura, não removido.

**Nota — `@emailjs/browser@4` sem pin de patch:** a tag `@4` no CDN resolve para a última versão
menor/patch compatível automaticamente — uma mudança de comportamento na biblioteca pode chegar
sem um commit neste repositório. O hash SRI protege contra adulteração do arquivo, mas NÃO contra
uma nova versão legítima da própria biblioteca mudar de comportamento (o hash mudaria e o browser
recusaria carregar até o `index.html` ser atualizado com o novo hash — na prática isso quebra o
recibo até alguém notar e corrigir, não silenciosamente muda o comportamento).

## Dependências de build/dev

**Nenhuma.** Sem `package.json`, sem `node_modules` em produção, sem bundler (ver `ADR-001`).

## Dependências de rede externas (não-CDN, chamadas em runtime)

| Serviço | Endpoint | Uso | Autenticação |
|---|---|---|---|
| Supabase REST | `https://cmhqkkfczotdnssupkni.supabase.co/rest/v1/bolao_state` | Persistência de estado | `anon key` pública (nunca `service_role`) + RLS restrito a `id='cdb2026'` |
| ESPN (site.api.espn.com) | `.../soccer/bra.copa_do_brazil/scoreboard` | Sincronização de confrontos/resultados | Nenhuma (endpoint público, sem chave) |
| EmailJS API | `api.emailjs.com` | Envio de recibo/notificação admin | `publicKey` pública, própria do EmailJS |

Todos os 3 estão na `connect-src` do CSP (`index.html:11`) — nenhum outro destino de rede é
permitido pelo navegador.

## Ferramentas de auditoria (dependências de desenvolvimento/CI, não de produção)

| Script | Runtime | Dependências externas |
|---|---|---|
| `audit_scoring.py` | Python 3, stdlib apenas | Nenhuma |
| `audit_state_merge.mjs` | Node.js, ESM, stdlib apenas (`node:fs`, `node:url`, `node:path`) | Nenhuma |
| `audit_golden_master.mjs` | Node.js, ESM, stdlib apenas + `node:crypto` para hash | Nenhuma |
| `audit_integrity.py` | Python 3, stdlib apenas (`argparse`, `json`, `os`, `re`, `datetime`) | Nenhuma |

Nenhum dos 4 scripts de auditoria tem qualquer dependência externa — todos rodam com apenas
Python 3 / Node.js já presentes no ambiente, sem `pip install`/`npm install`.
