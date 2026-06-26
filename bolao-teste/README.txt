# Bolão do Ferrari — Copa do Mundo 2026

Site estático de teste para o bolão.

## Estrutura

bolao-teste/
├── index.html
├── css/styles.css
├── js/config.js
├── js/data.js
├── js/app.js
├── assets/whatsapp-group-qr.png
├── admin/
└── README.txt

## Publicação no GitHub Pages

Coloque a pasta `bolao-teste` dentro do repositório `ferrarilabs.github.io`.

Depois de fazer merge para `main`, acesse:

https://ferrarilabs.github.io/bolao-teste/

## Importante

Esta versão salva dados no localStorage do navegador.
Para produção real com amigos, o próximo passo é conectar Firebase ou Supabase.


## Novidades v12

- Comprovante agora resolve os nomes dos times escolhidos nas fases futuras, em vez de mostrar apenas "Winner Match XYZ".
- Campo opcional de e-mail do participante.
- Botões de e-mail via `mailto:` para participante e admin.
- Contador ativo para o cutoff: 1 hora antes da primeira partida do mata-mata.
- Bloqueio local do formulário depois do cutoff.
- Aviso legal nas simulações automáticas.
- Configuração preparada para futura integração com Polymarket Gamma API.


## Novidades v13

- Idiomas: Português Brasil, Español e English (USA).
- Seletor de idioma no topo.
- Exportação de backup:
  - JSON completo
  - CSV completo com palpites
  - CSV master list sem todos os palpites
  - master list HTML
- Disclaimer legal e operacional adicionado.
- Melhorias de UX mobile.
- Preparado para EmailJS:
  - configure `js/config.js`
  - `emailMode: "emailjs"`
  - `emailjs.enabled: true`
  - preencha `publicKey`, `serviceId`, `participantTemplateId`, `adminTemplateId`
- Segurança:
  - senha admin em JavaScript é apenas proteção visual, não segurança real.
  - localStorage é local do navegador, não banco central.
  - para operação oficial com várias pessoas, usar Firebase/Supabase.
