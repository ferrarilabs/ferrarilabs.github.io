# Bolão Copa 2026 — Site de teste

Este é um teste estático para subir no seu website.

## Como publicar no seu site

1. Baixe o ZIP.
2. Descompacte.
3. Suba a pasta `bolao` ou os arquivos para o seu hosting.
4. Se quiser usar `seudominio.com/bolao`, crie uma pasta chamada `bolao` no servidor e envie:
   - index.html
   - styles.css
   - app.js
   - data.js

## Importante

Esta versão salva entradas no `localStorage` do navegador.
Isso serve para testar visual, fluxo e regras.

Para uso real com amigos, precisamos conectar a:
- Firebase Firestore, ou
- Supabase

Aí as entradas ficam salvas em banco de dados e o ranking atualiza para todo mundo.


## Novidades v2

- Admin com senha simples de teste: bolao2026
- Fases futuras do bracket atualizam os times conforme os palpites anteriores.
- Exemplo: se você escolhe Brasil no Match 73, o próximo jogo mostra Brasil. Se escolher Holanda, o próximo jogo passa a mostrar Holanda.

Atenção: senha em JavaScript NÃO é segurança real. Para produção, usar Firebase Auth/Supabase Auth ou área protegida no servidor.


## Correções v3

- Corrigido bug de atualização dinâmica.
- Pontuação agora compara o lado/posição do bracket (A/B), não apenas o nome do time.
- Isso aplica corretamente a regra de “se a Holanda herda a vaga do Brasil, o palpite daquele lado continua valendo”.
- Admin também recalcula os times futuros conforme os resultados reais lançados.


## Correções v4

- No palpite, “quem avança” só fica habilitado quando o placar digitado está empatado.
- Se o placar for 2x1, 3x0, etc., o avanço é automático para quem ganhou.
- Aviso adicionado: placar válido é 90 minutos + prorrogação; pênaltis não entram no placar.


## Novidades v5

- Bônus finais adicionados:
  - Campeão exato: +25
  - Vice-campeão exato: +15
  - 3º lugar exato: +10
  - 4º lugar exato: +5
- Ranking soma pontos dos jogos + bônus finais.


## Correções v6

- Corrigido bug em empate 0x0: dropdown de quem avança agora habilita corretamente.
- Se o placar não empatar, o dropdown é populado automaticamente com o vencedor e bloqueado.
- Placar válido explicitado: 90 minutos + prorrogação; pênaltis não entram no placar.
- Revisado fluxo de fases futuras, bônus finais e cálculo por posição do bracket.


## Novidades v7

- Label cosmético:
  - fases normais: “Quem avança?”
  - Final e 3º lugar: “Quem ganha?”
- Comprovante por entrada:
  - código de autenticação local
  - abrir comprovante em HTML
  - baixar HTML e salvar/imprimir como PDF
- Botão de simulação:
  - “Simular palpites automaticamente” baseado em força estimada
  - “Simular maluco” aleatório
- Revisado JS por sintaxe.


## Novidades v8

- Campo de método de pagamento:
  - CashApp: $emferrari
  - Zelle: 914-406-5027
  - PayPal: emferrari@gmail.com
  - Venmo: Eduardo-Ferrari
- Botão copiar dados de pagamento.
- Comprovante inclui método e destino do pagamento.
- Meta tag noindex/nofollow para reduzir chance de indexação.
- Ainda salva localmente no navegador; para produção real, conectar Firebase/Supabase.
