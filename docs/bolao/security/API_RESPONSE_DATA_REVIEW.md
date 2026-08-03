# API Response Data Review — Excessive Data Exposure

2026-08-02. Cobre Parte 1 item 10 e Parte 2 item 3 da revisão de segurança (mesmo tema, uma
única análise). Método: leitura de código (`state()` shape em `ARCHITECTURE.md`/`PROJECT_MEMORY.md`,
`renderRanking()`/`renderAll()` em `js/app.js`) + o teste passivo real já documentado em
`SUPABASE_SECURITY_REVIEW.md` (GET com a chave anon pública).

## Princípio

Um campo que chega ao navegador está exposto ao usuário desse navegador **mesmo que a UI nunca
mostre esse campo na tela**. Ocultar um campo no CSS/JS não é proteção — qualquer participante
pode abrir a aba Network do DevTools, ou repetir a mesma chamada REST fora do app (como esta
auditoria fez), e ver o JSON completo.

## Schema real da resposta (`GET /rest/v1/bolao_state?select=*`)

| Endpoint | Consumidor pretendido | Campos retornados | Campos realmente usados pela UI | Campos sensíveis | Excesso identificado |
|---|---|---|---|---|---|
| `bolao_state` (linha `main`/`br2026`/`cdb2026`) | O próprio app (via `?id=eq.<own-id>`) | `id`, `state` (JSON completo: `entries[]` com `id,entryName,payerName,participantEmail,paymentMethod,paymentTo,createdAt,updatedAt,picks,diagnostics`; `paid{}`; `results{}`/`phases{}`; `auditLog[]`; `deletedIds[]`; `meta`), `updated_at` | Ranking usa `entryName`, pontuação calculada, status de pagamento (ícone sim/não); painel admin usa tudo | `participantEmail`, `paymentTo` (identificador da conta de recebimento, ex. `$EduardoFerrari`/telefone Zelle — do organizador, não do participante, mas ainda assim um dado de contato pessoal do Eduardo, repetido em cada entrada), `diagnostics` (userAgent, timezone, viewport, capturedAt — fingerprint de dispositivo/navegador), `auditLog` completo (histórico de ações admin, inclusive antes de qualquer filtro de visualização) | O ranking público não precisa de `participantEmail`, `diagnostics`, ou `auditLog` para renderizar — hoje ele recebe (porque o app busca o documento inteiro) mesmo que não exiba |
| `bolao_state` (**sem filtro de `id`**, testado nesta auditoria) | Ninguém no app — só alcançável via chamada direta à API, fora da UI | As **3 linhas completas** acima, de uma vez | N/A — nenhuma tela do site faz essa chamada sem filtro | Mesmos campos acima, **multiplicados pelos 3 apps** — um leitor do BR2026 recebe também PII de participantes da Copa e do CDB2026 | Esse é o achado central desta seção: o app em si sempre filtra por `id`, mas a API por trás dele não impõe esse filtro — é só convenção do cliente, não do servidor |

## Um campo específico merece nota: `diagnostics`

`entries[].diagnostics` grava `userAgent`, `timezone`, `viewport`, `capturedAt` no momento da
submissão (confirmado em `ARCHITECTURE.md`, shape do state). Não é IP bruto, não é geolocalização
precisa, não é um identificador de conta — mas é um fingerprint de navegador que, combinado com
nome+e-mail já expostos no mesmo objeto, aumenta a granularidade de PII disponível sem trazer
benefício de produto óbvio para quem só quer ver o ranking. Nenhuma tela do app exibe esse campo
para o participante — existe apenas para suporte/depuração do admin em caso de disputa.

## Recomendações (não implementadas nesta revisão — somente leitura)

1. **View pública com projeção de colunas.** Se/quando o modelo evoluir para tabelas separadas
   (ver `docs/bolao/adr/ADR-006-supabase-rls-hardening-and-future-architecture.md`), criar uma
   `view` ou RPC que devolve só `entryName`, pontuação, posição, status de pagamento (booleano) —
   nunca `participantEmail`, `diagnostics`, ou `auditLog` — para qualquer consumo que não seja o
   próprio admin autenticado.
2. **Não buscar o documento inteiro para renderizar o ranking.** Hoje `loadRemoteState()` sempre
   busca `select=*`; um RPC de leitura com projeção explícita reduziria o excesso mesmo sem
   dividir tabelas.
3. **Considerar remover `paymentTo`/`diagnostics` do payload de entrada** se não forem
   estritamente necessários para o fluxo de disputa — ou movê-los para um objeto separado que só
   o admin consulta.
4. **DTOs mínimos para qualquer nova API futura** — nunca reusar o shape de armazenamento interno
   como shape de resposta pública.

## Aplicabilidade

Este é o **único** ponto de "resposta de API" real na plataforma (não há outro endpoint JSON
customizado). EmailJS/ESPN/API-Football são consumidos, não servidos, pela plataforma — não se
aplicam a esta revisão de exposição de dados de saída.
