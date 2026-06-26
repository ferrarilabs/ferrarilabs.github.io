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


## v1.3 final fixes

- Corrigido título da aba do browser.
- Corrigido CashApp para `$EduardoFerrari`.
- Melhorado layout do contador.
- Atualizados resultados:
  - France 4 x 1 Norway
  - Senegal 5 x 0 Iraq
- Admin deixa claro que:
  - Polymarket é teste de conexão e ainda não alimenta automaticamente os palpites.
  - API de resultados ainda está manual nesta versão estática.


## v1.4 PDF receipt + email formatting

- Após salvar uma entrada, aparece um card de comprovante imediatamente.
- Botões:
  - Abrir comprovante
  - Baixar PDF
  - Baixar HTML
  - Enviar por e-mail
- PDF gerado no navegador usando html2pdf.js.
- E-mail recebe `html_message`, `receipt_html` e `receipt_text_pretty` para templates mais bem formatados.

### Sugestão para o template EmailJS

Use `{{{html_message}}}` no corpo se o EmailJS permitir HTML sem escapar.
Se não permitir, use `{{receipt_text}}` ou `{{receipt_text_pretty}}` com quebras.


## v1.5 Polymarket simulator adjustment

- Simulador automático:
  - tenta carregar mercados do Polymarket Gamma API;
  - tenta encontrar mercado compatível por time A x time B;
  - usa outcomePrices/outcomes quando consegue mapear;
  - sorteia o vencedor de acordo com a probabilidade normalizada;
  - usa modelo local como fallback quando não encontra mercado.
- Simulador maluco:
  - continua quase aleatório.
- Adicionado bloco/tooltip "Como funciona?".
- Importante: o mapeamento de mercados por texto ainda é heurístico e precisa validação antes de uso oficial.


## v1.6 Public ranking/admin separation

- Ranking público mostra apenas ranking e botão para ver palpites.
- Botões administrativos de comprovante/e-mail/PDF foram movidos para Admin.
- Adicionado botão WhatsApp no topo para suporte/grupo.
- Jogos exibem data/hora/local quando disponível.
- Horário exibido em ET (Eastern Time). Locais não confirmados aparecem como "A confirmar".
- Mais chaves adicionadas ao i18n, mas o conteúdo dinâmico de jogos/times permanece como nomes oficiais.

## v1.7 polish/fixes

- Remove botão "Como funciona"; mantém a caixa explicativa fixa.
- Corrige CashApp para `$EduardoFerrari`.
- Adiciona SVGs locais simples para WhatsApp, CashApp, Zelle, PayPal e Venmo.
- PDF não baixa mais branco: agora abre a página do comprovante e chama imprimir/salvar PDF.
- Melhora contador de fim das apostas.
- Ajusta tradução dinâmica para mais elementos.
- Melhora layout responsivo e esconde sidebar mais cedo.
