# Bolão do Ferrari — v1.0 Teste com Amigos

## URL depois do merge

https://ferrarilabs.github.io/bolao-teste/

## Incluído

- Design dashboard mobile/desktop
- Português BR, Español e English
- EmailJS configurado:
  - Public Key: GBZFujsJBET6modve
  - Service ID: service_o4hyzxr
  - Participant template: template_xq7yzzb
  - Admin template: template_4sgp5r9
- QR Code do WhatsApp
- Zelle QR se disponível
- CashApp, Zelle, PayPal, Venmo
- Comprovantes HTML
- E-mail automático via EmailJS
- Backup JSON
- Backup CSV
- Master list CSV/HTML
- Cutoff com contador
- Senha admin em hash SHA-256
- Lockout temporário
- Escape básico de HTML/XSS
- CSP básica

## Senha admin de teste

bolao2026

## Atenção sobre segurança

Este site roda no GitHub Pages, portanto é estático. A senha admin com hash protege apenas contra usuários casuais.
Um usuário técnico pode contornar controles de front-end.

Para uso oficial/produção:
- Firebase Auth ou Supabase Auth
- Firestore/Postgres com regras
- cutoff validado no servidor
- registros append-only
- master list pública/read-only após cutoff

## Como subir

1. Descompacte o ZIP.
2. No GitHub Desktop, abra `ferrarilabs.github.io`.
3. Branch: `feature/bolao2026`.
4. Apague a pasta antiga `bolao-teste`.
5. Arraste a nova pasta `bolao-teste` para dentro do repo.
6. Confira que os arquivos aparecem como `bolao-teste/...`.
7. Commit: `Release bolao test v1`
8. Push origin.
9. Abra Pull Request para `main`.
10. Confira Files changed: só `bolao-teste/...`.
11. Merge.
12. Aguarde 2–5 minutos.
13. Acesse https://ferrarilabs.github.io/bolao-teste/

## Teste recomendado

- Abra no celular.
- Crie uma entrada com seu e-mail.
- Verifique se participante recebe e-mail.
- Verifique se admin recebe e-mail.
- Baixe backup CSV/JSON.
- Abra Master List.
- Teste senha admin errada 5 vezes.


## Último checklist antes de subir

- Subir somente a pasta `bolao-teste`.
- Não subir `.DS_Store`.
- Conferir que GitHub Desktop mostra apenas arquivos `bolao-teste/...`.
- Testar no celular após o merge.
- Criar uma entrada sua primeiro e confirmar se:
  - comprovante abre;
  - e-mail chega para participante;
  - e-mail chega para admin;
  - backup CSV/JSON baixa;
  - master list abre.


## v1.2 Diagnostics / external sources

### Captured diagnostics per entry

If enabled in `js/config.js`, each entry captures:
- public IP via `https://api.ipify.org?format=json`
- user agent
- browser guess
- mobile/tablet/desktop guess
- platform
- timezone
- screen size
- viewport size
- referrer
- timestamp

This is for support/audit troubleshooting, not for identity proof.

### Polymarket

There is an admin test button for Polymarket Gamma API:
- Admin → Fontes externas e diagnóstico → Testar Polymarket

Important:
- Gamma API is public/no-auth, but market mapping must be validated.
- The current auto-prediction model still uses local estimated strengths.
- Do not treat Polymarket as official scoring/result source.

### FIFA/results API

No official browser-safe FIFA results API is configured in this static GitHub Pages version.
Results remain manual unless a backend/proxy is added.

Recommended production approach:
- Firebase Function or Cloudflare Worker
- Pull from API-FOOTBALL, Sportmonks, BallDontLie, or another provider
- Do not expose API keys in GitHub Pages JavaScript
