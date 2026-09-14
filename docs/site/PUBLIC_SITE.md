# Site profissional (www.ferrarilabs.com) — páginas, SEO e privacidade

Issue #434. Este documento cobre só o site profissional na raiz do repositório. Os apps
`/bolao/` têm governança própria (`docs/bolao/`) e **não** são afetados por nada daqui.

## Classificação das páginas da raiz

| Página | Categoria | Sitemap | Analytics |
|---|---|---|---|
| `index.html`, `index.pt.html`, `index.es.html`, `index.jp.html` | indexável, traduções entre si (hreflang recíproco + `x-default` → `/`) | sim | opt-in via `site.js` |
| `insights.html` | indexável, só inglês (sem hreflang) | sim | opt-in via `site.js` |
| `privacy.html`, `terms.html` | indexável, só inglês | sim | opt-in via `site.js` |
| `404.html` | noindex — GitHub Pages serve para qualquer caminho inexistente; por isso todo link é absoluto (`/…`) | não | nenhum |
| `thanks.html` | noindex — confirmação do formulário (ver pendência abaixo) | não | nenhum |

Uma página nova na raiz **precisa** ser classificada em `scripts/site/check_public_pages.mjs`
(`INDEXABLE` ou `NOINDEX`); o gate reprova página não classificada.

## robots.txt

Não bloqueia `/bolao/` de propósito: os apps têm `<meta name="robots" content="noindex,nofollow">`,
e uma página bloqueada no robots.txt nunca tem esse noindex lido pelo crawler. Bloqueia só
diretórios de ferramenta/documentação que o Pages serve por acidente (`/docs/`, `/scripts/`,
`/supabase/`, `/workers/`, `/model/`, `/memory/`) — nenhuma página depende deles para renderizar.

## Google Analytics (GA4 `G-KF98YDJNK7`) — opt-in real

`site.js` é carregado **síncrono** no `<head>` porque as páginas têm handlers inline
`onclick="gtag(...)"`/`onsubmit="gtag(...)"`:

- `window.gtag` existe sempre; antes do aceite ele descarta a chamada (nada vai para o `dataLayer`).
- `gtag.js` só é requisitado depois de "Allow analytics" (ou numa visita em que o aceite já está
  salvo em `localStorage.analytics_consent`).
- "Decline" persiste a recusa, liga `ga-disable-G-KF98YDJNK7` e apaga cookies `_ga*`.
- A escolha pode ser revista em `privacy.html` (botões `data-consent-choice`).
- Não é Consent Mode "advanced": com recusa não há nem ping sem cookie, porque a biblioteca nem
  carrega.

**Trade-off consciente:** visitante que ignora o banner não é medido. O volume do GA4 cai em
relação ao carregamento incondicional anterior.

## Formulário de contato

Continua POST nativo para Formspree (sem AJAX). `site.js` só acrescenta o estado "enviando"
(botão desabilitado + `aria-busy` + região `aria-live`), evita envio duplo e devolve o botão em
retorno via back/forward cache ou após 15 s sem navegação. Erros de validação continuam nativos;
erro do servidor continua na página do Formspree. O evento `contact_form_submit` continua sendo
disparado no submit (não é "lead concluído").

## Pendências que dependem de humano

- **Redirecionamento para `thanks.html`:** configurar no painel do Formspree o redirect para
  `https://www.ferrarilabs.com/thanks.html`. Não foi colocado `_next` no HTML porque não é
  possível provar pelo repositório que o plano do Formspree o aceita.
- **Favicon / apple-touch-icon / `og:image`:** não existe asset oficial de marca no repositório.
  Nada foi improvisado; `twitter:card` usa `summary` (sem imagem). O gate aceita `og:image` apenas
  apontando para um arquivo que exista.
- **Privacy/Terms traduzidos:** hoje só em inglês; os footers PT/ES/JA apontam para eles com
  `hreflang="en"`.

## Gate

`node scripts/site/check_public_pages.mjs` (id `public-site-pages` no `verify.mjs`) +
`node scripts/site/test_check_public_pages.mjs` (mutações). Ambos rodam em `npm run check`.
