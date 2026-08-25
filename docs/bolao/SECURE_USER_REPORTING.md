# Reportar problema — arquitetura, ameaças e privacidade

**Issue:** #321 · **Estado:** implementado e **DESLIGADO** nas duas chaves
**Runtime:** **Cloudflare Worker** `ferrarilabs-support-intake` — ver `adr/ADR-021-intake-em-cloudflare-worker.md`
**Estado de ativação:** `CODE_ONLY` · **Prontidão:** `NOT_READY`
**Rastreabilidade:** `USER_REPORT_REQUIREMENTS_TRACEABILITY_MATRIX.md`

> **Mudança de runtime (2026-08-24).** O intake **não** roda mais como Edge Function do projeto
> Supabase do Ferrari Labs, e **não** é mais um projeto Supabase separado. Ele é um **Cloudflare
> Worker dedicado**, cujo código vive em `workers/user-report-intake/`.
>
> O motivo está em ADR-021 e resume-se a uma frase: no Supabase, os segredos do projeto são
> **injetados** em toda Edge Function; num Worker, os bindings são **declarados**. O que não está no
> `wrangler.jsonc` não existe no ambiente. A fronteira deixa de ser uma afirmação sobre o nosso
> código e passa a ser uma propriedade da plataforma.
>
> A função legada continua **implantada e inerte** no projeto primário — verificado: remover o
> diretório do repositório **não** a apagou. Deletá-la é ato do dono (Human Gate).

## 1. O que isto é

Um canal de intake de incidentes **externo e não confiável**, ligado a uma aplicação web pública.
Não é "um botão": é uma superfície de ataque nova, e o desenho parte disso.

## 2. Fluxo

```
CLIENTE PÚBLICO (navegador do participante)
   │  coletor de contexto SEGURO (allowlist) + sanitizador local
   ▼
CLOUDFLARE WORKER  ferrarilabs-support-intake     ← workers/user-report-intake/
   │  1. preflight CORS (allowlist exata)
   │  2. método / origem
   │  3. INTERRUPTOR DE SERVIDOR      ← antes de QUALQUER dependência
   │  4. content-type / tamanho
   │  5. configuração completa
   │  6. schema allowlist              (campo desconhecido reprova o corpo inteiro)
   │  7. pré-filtro de rajada          (binding nativo de Rate Limiting)
   │  8. estado durável                (Durable Object: limites, idempotência, disjuntor)
   │  9. token de instalação de GitHub App   (curto, em memória)
   │ 10. INVARIANTE: destino é PRIVADO ← última linha antes da divulgação
   ▼
ferrarilabs/support-intake   (PRIVADO)
   │  triagem humana
   ▼
(opcional, autorizado) Issue de engenharia SANITIZADA no repositório público
```

**O que NÃO está neste diagrama, e é o ponto:** o projeto Supabase "Bolão do Ferrari". Ele não
participa do runtime de reporte. Não há binding, credencial, RPC nem rota entre os dois.

## 3. A decisão central

**Relato bruto de participante nunca cruza automaticamente a fronteira privado→público.**

Regex não reconhece nome de pessoa, nem "meu vizinho do mercado", nem circunstância pessoal. Fingir
que reconhece seria a falha de desenho mais cara possível aqui. Por isso o relato fica **privado**, e
só metadado técnico sanitizado é promovível — com autorização explícita.

## 4. Segmentação de confiança

O Worker **não alcança** banco de participante, pagamento, scoring ou competição — e isso não é uma
promessa sobre o código, é a lista de bindings:

| binding | para quê |
|---|---|
| `ESTADO` (Durable Object, SQLite) | idempotência, deduplicação, limites deslizantes, disjuntor |
| `RAJADA` (Rate Limiting) | pré-filtro de rajada, local ao colo |
| `VERSAO` (`version_metadata`) | identidade da versão publicada (`x-deploy-id`) |
| segredos | GitHub App (3) + HMAC de abuso (1) |

Não há `d1_databases`, `hyperdrive`, `services`, `r2_buckets`, `queues`, nem `SUPABASE_*`. Um
comprometimento total do Worker alcança exatamente: a API do GitHub, com escopo de **um**
repositório privado e **uma** permissão.

> ### T-ENV-01 — resolvido pela plataforma, não pela disciplina
>
> A ameaça original: o runtime hospedado de Edge Function do Supabase injeta `SUPABASE_DB_URL`,
> `SUPABASE_SECRET_KEYS` e o legado `SUPABASE_SERVICE_ROLE_KEY` (que **ignora RLS**) em toda função
> do projeto. A mitigação anterior era uma catraca de CI que proibia **referenciar** esses nomes —
> proteção contra erro de programação, não contra comprometimento de runtime, dependência hostil,
> defeito de injeção futuro ou cadeia de suprimentos.
>
> **Estado agora:** o intake roda num runtime onde essas variáveis **não existem**. A catraca
> `test_worker_isolation.mjs` mede a lista de bindings, não a boa vontade do autor.
>
> **Risco residual:** a função legada continua implantada e inerte no projeto primário. Ela não tem
> segredo provisionado e o interruptor dela está desligado — mas o isolamento só fica completo
> quando o dono a apagar.

## 4-A. O interruptor de servidor

`REPORT_INTAKE_ENABLED` é um gate **independente dos oito segredos**, avaliado **antes** de
qualquer dependência: nada de Redis, nada de GitHub, nada de JWT, nada de parsear corpo.

**Só a string exata `"true"` liga.** `"TRUE"`, `"1"`, `"yes"`, espaço sobrando, ausente e vazio
significam DESLIGADO. Não há coerção — um interruptor de segurança que aceita sinônimos é um
interruptor que alguém liga sem querer.

Desligado responde **exatamente** como não-configurado (`503 {"error":"UNAVAILABLE"}`). Quem sonda
não aprende se o canal está desligado ou incompleto; isso não é informação dele.

> **Por que isto existe.** Antes, o canal ligava sozinho no instante em que o oitavo segredo fosse
> provisionado: "provisionar dependência" e "abrir endpoint público ao mundo" eram o mesmo ato, sem
> ninguém decidir a segunda coisa. **Preparar infraestrutura não pode ser, por acidente, um
> lançamento.** Ver `T-ACT-01` no §8.

## 4-B. Ativação em duas chaves — invariante de deploy

Dois gates **independentes**, e o rollout público exige os dois deliberadamente ligados:

| gate | onde | papel |
|---|---|---|
| `REPORT_INTAKE_ENABLED=true` | servidor (segredo do projeto) | **a fronteira de segurança** |
| `reportProblem.enabled=true` | cliente (`config.js` dos apps) | defesa em profundidade / controle de UX |

O flag do cliente **não** é a fronteira: ele roda no navegador do participante, que o edita à
vontade. Ele existe para que a UI não apareça, não para impedir requisição.

**Máquina de estados.** Transições são atos deliberados, nunca efeito colateral:

```
CODE_ONLY                      código no repo; nenhum segredo; servidor OFF; UI OFF
        │  provisionar dependências (Redis, GitHub App, HMAC)
        ▼
BACKEND_PROVISIONED_DISABLED   oito segredos existem; servidor AINDA OFF   ← estado seguro e estável
        │  ligar servidor só para aceitação
        ▼
BACKEND_ACCEPTANCE             servidor ON; UI OFF; reporte sintético ponta a ponta
        │  aceitação passa
        ▼
BACKEND_ENABLED_UI_DISABLED    servidor ON; UI ainda OFF
        │  decisão de lançamento
        ▼
PUBLIC_ENABLED                 servidor ON; UI ON
        │  incidente
        ▼
EMERGENCY_DISABLED             servidor OFF  ← PRIMEIRA ação de rollback, sempre
```

**Rollback começa sempre pelo servidor** (`REPORT_INTAKE_ENABLED=false`), não pelo cliente: o
cliente só esconde o botão, e um navegador com a página velha em cache continua conseguindo POSTar.

## 5. Dados coletados

| coletado | por quê |
|---|---|
| app, versão do site | reproduzir na versão certa |
| `routeId` (sem query, sem hash) | onde aconteceu |
| `sectionId` | qual parte da tela |
| locale | reproduzir no idioma |
| viewport | classe de defeito responsivo (foi assim na #316) |
| online | separa falha de rede de falha de servidor |
| motor do navegador (grosso) | classe de bug de compatibilidade |
| código de diagnóstico (allowlist) | o que o produto já sabia |
| relato e ação tentada | o que a pessoa observou |

**Explicitamente NÃO coletado:** nome · e-mail · telefone · URL completa · query · hash · token de
entrada · token de auth · referência de pagamento · valor · palpites · `localStorage` ·
`sessionStorage` · cookies · IP persistido · referrer · User-Agent completo · stack trace ·
console · anexos · screenshots.

Versão exata do navegador **não** é coletada: é impressão digital sem uso comprovado.

## 6. Identificador de rede

Nenhum IP é persistido. A chave de taxa é
`HMAC-SHA256(segredo, YYYY-MM-DD || valor_de_rede)` — guarda-se só o HMAC, que **rotaciona sozinho
todo dia** pelo componente de data. Nem o valor de rede nem o HMAC vão para log.

## 7. Abuso

| controle | padrão | razão |
|---|---|---|
| por rede/sessão | 3/10min, 10/dia | cobre "tentei de novo" sem virar canal de spam |
| global | 30/10min, 200/dia | teto do bolão inteiro |
| duplicata | 10 min | mesma pessoa, mesmo texto = reenvio |
| idempotência | 7 dias | cobre reenvio manual tardio |
| disjuntor | 15 min | estourar o global é ataque, não uso |

Operações atômicas (`INCR` + `EXPIRE` no nascimento do contador) — nunca ler-depois-escrever, que
tem corrida. **Falha fechado**: limitador indisponível ⇒ recusa.

## 8. Modelo de ameaças

| ameaça | ativo | controle | risco residual | evidência |
|---|---|---|---|---|
| Spam / DoS | repo privado, custo | limite por rede + global + disjuntor, fail-closed | atacante distribuído consome cota global e nega serviço a participantes reais | `test_report_intake` (limites, disjuntor) |
| Enchente de Issues | triagem | dedup por impressão HMAC + idempotência | relatos diferentes com mesmo texto colapsam | idem |
| Exfiltração de credencial | GitHub App, HMAC | segredo só server-side (Cloudflare Secrets); catraca de bundle | comprometimento do runtime Cloudflare | `test_report_security_ratchets` §1, `test_worker_isolation` §3 |
| XSS | quem lê o Issue | HTML escapado, texto em bloco | — | corpus adversarial |
| Injeção de Markdown | leitor / rastreio | `!` escapado, menção e `#ref` neutralizados | link continua visível como texto (proposital: o triador precisa ler) | corpus |
| **Injeção de prompt** | agente que lê intake | aviso `UNTRUSTED_EXTERNAL_INPUT` antes do relato; runbook proíbe executar | um agente mal instruído ainda pode obedecer | corpus + §9 |
| PII submetida sem querer | participante | aviso na UI + redação de padrões óbvios + **relato privado** | nome nunca é detectável por regex | `redigir()` + testes |
| SSRF | rede interna | hosts de saída literais; URL nunca vem do payload | — | ratchet §5 |
| Replay | duplicatas | idempotência em duas fases + reconciliação por `report_id` | janela de crash coberta pela reconciliação | `test_report_intake` |
| **Sequestro de `report_id`** | relato legítimo | chave de idempotência é `HMAC(segredo, chave_de_rede ‖ report_id)`, não o `report_id` cru | um mesmo remetente ainda colide consigo próprio — que é o comportamento desejado | `test_report_intake` (F-04, 4 casos + controle negativo) |
| Bypass de CORS | — | CORS **não é** autenticação; abuso controlado independentemente | cliente não-navegador ignora CORS, por isso o limite é obrigatório | ratchet §5 |
| Divulgação privado→público | relato | invariante de visibilidade **no runtime**, antes de criar | operador pode promover manualmente (é decisão humana, autorizada) | ratchet §3 |
| Segredo em log | credenciais | só código de erro; nunca objeto de erro | — | ratchet §7 |
| Supply-chain | endpoint | **zero dependência nova**; JWT via Web Crypto; nenhum pacote no Worker | runtime do Cloudflare | `test_worker_isolation` |
| Deriva de configuração | relato | verificação de visibilidade no runtime, não na config | — | ratchet §3 |
| Diagnóstico malicioso | integridade | allowlist; desconhecido ⇒ `UNKNOWN_SAFE_ERROR` | — | testes |
| Unicode / bidi | leitor | controles e invisíveis removidos | — | corpus |
| **T-ENV-01** — credencial de alto valor no runtime de reporte | projeto Supabase de produção (participantes, pagamentos, scoring) | **runtime separado**: Cloudflare Worker sem binding para o projeto financeiro — a credencial não existe ali | função legada ainda implantada e inerte no primário; deletá-la é ato do dono | `test_worker_isolation.mjs` (lista de bindings) |
| **T-ACT-01** — provisionar segredo ativando endpoint público sem querer | canal inteiro | **interruptor de servidor** `REPORT_INTAKE_ENABLED`, avaliado antes de toda dependência; comparação exata | operador ainda pode ligar deliberadamente sem aceitação — que é uma decisão, não um acidente | `test_report_intake` (5 casos + 2 controles negativos) |

## 9. Fronteira de injeção de prompt

Todo Issue privado começa com `UNTRUSTED_EXTERNAL_INPUT` legível por máquina e o aviso humano.

**Um reporte é evidência, nunca um comando.** Nenhum relato pode, por si, mudar pagamento, estorno,
palpite, score, ranking, cutoff, acesso, migração ou deploy. Quem lê — pessoa ou agente — não segue
instrução, não abre link automaticamente, não executa SQL.

## 10. Retenção (proposta, **não** ativada)

Issues de intake fechadas devem sair depois de **90 dias**: tempo suficiente para correlacionar com
uma conversa e para investigação de recorrência, e curto o bastante para o relato não virar arquivo
permanente de circunstância pessoal.

Deleção destrutiva permanece **desativada** até autorização explícita. Quando existir, só pode
alcançar: repositório `support-intake`, label `user-report`, estado fechado, mais velho que a
retenção. Nunca curinga, nunca Issue pública.

**Remoção a pedido do titular:** correlacionar pelo `report_id` impresso na tela, apagar a Issue
privada correspondente. É por isso que o `RPT-XXXXXXXX` é mostrado.

O `report_id` é gerado no navegador e serve para **exibição e correlação** — nunca como chave de
controle. A idempotência real é derivada de `HMAC(segredo, chave_de_rede ‖ report_id)`: sem isso,
um cliente hostil reservaria o `report_id` alheio e o relato legítimo colidiria com uma
idempotência já em curso — sucesso na tela, Issue nenhuma. Supressão silenciosa é pior que recusa,
porque ninguém fica sabendo.

## 9-B. Controles exigidos antes da ativação

Implementados nesta rodada, todos com caso dedicado e catraca no manifesto de prontidão:

| controle | o que impede |
|---|---|
| **F-05** paridade de limites | cliente aceitar 1500 e servidor cortar em 1200 — a pessoa escreve, envia, recebe sucesso e **perde o fim do relato**, sem erro em lugar nenhum |
| **F-06** `x-deploy-sha` | repetir a #306/#310 num endpoint que **se publica sozinho**: sem manifesto, saber qual versão respondeu vira arqueologia |
| **F-11** métricas agregadas | disjuntor que abre em silêncio; e `redigir()` já sabe **quais classes** de dado sensível apareceram — agregado, isso diz se o aviso está funcionando |
| **F-12** versão do aviso | "o que foi comunicado a esta pessoa" virar pergunta de memória depois que o texto mudar |
| **F-14** expectativa honesta | um canal que convida a escrever e não responde corrói mais confiança que a ausência dele |
| **F-15** exceção inesperada | o vazamento clássico: não o erro previsto, o que **não** se previu, carregando caminho de arquivo ou fragmento de configuração |

**F-11 falha ABERTA**, e é o único ponto do módulo que engole erro: perder um contador é
irrelevante, perder o relato de alguém não é.

**F-15 é uma casca total.** O `try` interno cobre o que a gente previu que falha (GitHub, Redis);
a casca externa cobre o resto. Prova: um caso injeta exceção **antes** do `try` interno e verifica
que a resposta é o mesmo 503 genérico, byte a byte.

## 9-C. Achados reavaliados — controle ou risco residual assumido

Nem todo achado vira código. Estes foram reavaliados um a um; onde não há controle, o motivo está
escrito, porque risco não registrado é risco que ninguém decidiu correr.

### Controle implementado

- **F-10 — chave privada longeva.** Cadência de rotação **datada**: a chave privada da GitHub App
  é rotacionada **a cada 6 meses**, e imediatamente após qualquer suspeita de comprometimento do
  runtime. O token de instalação já expira sozinho (~1h) e nunca é persistido. Antes disto a
  rotação existia como procedimento sem **quando**, e procedimento sem quando não acontece.
- **F-13 — bandeira em três cópias.** Coberta pelo item `ui_flag_off` do manifesto de prontidão,
  que exige as **três** desligadas e nomeia qual divergiu. Manter três cópias é deliberado (os apps
  não compartilham código); o que não podia continuar era ninguém verificar as três juntas.
- **F-16 — três jurisdições, nenhum mapa.** Tabela abaixo. Continua **não** havendo alegação de
  conformidade com GDPR, LGPD ou qualquer regime — isso exigiria avaliação formal que não foi
  feita. O que existe agora é a resposta para "onde o dado repousa", que antes não existia nem em
  rascunho.

| provedor | o que repousa lá | por quanto tempo | finalidade |
|---|---|---|---|
| Cloudflare (Worker + Durable Object) | chave de rede **pseudônima** (HMAC), chave de idempotência, impressão de duplicata, contadores | ≤ 24 h (o objeto apaga o que passa da janela) | controle de abuso e idempotência |
| Cloudflare (Workers Logs) | eventos agregados: código, contador, latência — **sem conteúdo** | retenção padrão da plataforma | operação |
| GitHub (`ferrarilabs/support-intake`, privado) | o relato, no Issue privado | retenção proposta de 90 dias (§10) | triagem |

**Região:** a ser registrada aqui pelo dono quando os recursos existirem. Workers executam na borda
por desenho; Durable Objects têm localidade escolhida na criação. **Não** há alegação de
conformidade com GDPR, LGPD, CCPA ou qualquer regime — isso exigiria avaliação formal que não foi
feita.

A região de cada provedor é escolhida na criação e deve ser **registrada aqui pelo dono** quando os
recursos existirem — ver o Human Gate.

### Risco residual assumido, com motivo

- **F-03 — falhar fechado silencia o participante real durante um incidente.** O controle óbvio
  seria reservar capacidade para remetentes "com histórico". Isso exige guardar um marcador durável
  por pessoa — exatamente o que a chave de taxa com componente de data foi desenhada para **não**
  ter. Trocar privacidade por disponibilidade aqui seria pagar o preço errado num canal cujo
  propósito é receber relato sem identificar quem relata. **Mitigação parcial:** com F-11, a
  abertura do disjuntor deixa de ser silenciosa — alguém pelo menos fica sabendo.
- **F-07 — retenção de 90 dias não aplicada por código.** O job de varredura precisa listar Issues
  do repositório privado, o que exige a GitHub App **que ainda não existe**. Implementá-lo agora
  produziria código que nunca rodou. Está no manifesto como item `OWNER`, e a deleção destrutiva
  continua exigindo autorização explícita e separada.
- **F-09 — a chave de taxa se renova para os dois lados.** O componente de data faz a rotação
  acontecer sem trabalho nenhum, e também entrega ao atacante uma identidade nova à meia-noite UTC:
  o limite "diário" é, na prática, por dia civil UTC. Uma janela deslizante exigiria reter um
  identificador por mais tempo — de novo, mais dado sobre pessoas para ganhar rigor contra abuso.
  **Aceito**, com o número honesto: perto da virada, ~20 envios cabem em minutos por chave de rede.
  O teto **global** e o disjuntor continuam valendo e são o que de fato limita o dano.

## 10-B. Prontidão — `UNKNOWN` nunca é `READY`

`node scripts/report/readiness.mjs` é o único lugar que responde "dá para ligar o canal?". Cada
item declara **como** é verificado: `REPO` (o processo decide sozinho), `RUNTIME` (precisa de
`--probe`), `OWNER` (só o dono confirma — painel, conta, provedor).

Um único `UNKNOWN` derruba o veredito para `NOT_READY`. A alternativa seria um verde que significa
"não achei problema", e num canal que abre superfície pública isso é pior que um vermelho.

Ele sai com código **0** de propósito: é relatório, não gate de CI. Reprovar o `npm run check`
porque o dono ainda não provisionou um recurso externo deixaria o pipeline vermelho por algo que nenhum
commit conserta — e vermelho permanente é vermelho que se aprende a ignorar.

## 11. Melhorias conhecidas (próxima versão)

1. ~~**Isolamento de runtime**~~ — resolvido por ADR-021 (Cloudflare Worker). Falta apenas o dono
   apagar a função legada, que segue implantada e inerte no projeto primário.
2. **UI e integração por app** — deliberadamente fora desta entrega: sem endpoint implantado, um
   botão visível seria um botão morto.
3. **Teste de integração HTTP real.** A política é pura e coberta; a *fiação* não era. Um
   preflight de origem permitida respondeu **500** em produção porque `new Response("", {status:204})`
   lança — 204/205/304 exigem corpo `null`. O caminho proibido (403) funcionava e só o caminho
   feliz estava quebrado, que é a assinatura clássica de defeito de fiação. Corrigido, com teste
   que passa toda resposta alcançável pelo construtor real de `Response`.
4. Assinatura/attestation do cliente para encarecer submissão automatizada sem exigir conta.
5. Métrica de custo por reporte e alarme de orçamento.

## 12. Inventário de segredos (só nomes)

`REPORT_GITHUB_APP_ID` · `REPORT_GITHUB_INSTALLATION_ID` · `REPORT_GITHUB_PRIVATE_KEY` ·
`REPORT_ABUSE_HMAC_SECRET`

Quatro, não oito: o **Upstash saiu**. O Durable Object substituiu o Redis externo, e com ele
sumiram `REPORT_REDIS_REST_URL` e `REPORT_REDIS_REST_TOKEN` — um fornecedor a menos, uma credencial
a menos, uma chamada de rede a menos no caminho do dado. `REPORT_GITHUB_OWNER` e
`REPORT_GITHUB_REPO` viraram `vars` (não são segredo)

Mais o **interruptor**, que não é segredo e não é dependência: `REPORT_INTAKE_ENABLED`. Os oito
acima vão para o projeto **de suporte**, nunca para o primário.

Rotação: gerar novo valor no provedor → `supabase secrets set` → invalidar o antigo. O token de
instalação do GitHub expira sozinho (~1h) e nunca é persistido.

## 13. Rollback

1. **`REPORT_INTAKE_ENABLED=false` no servidor.** Primeira ação, sempre: é a única que para
   requisição de verdade. O flag do cliente só esconde o botão, e um navegador com a página em
   cache continua conseguindo POSTar.
2. `reportProblem.enabled = false` (já é o padrão) — a UI some.
3. Reverter o PR do recurso. **Reverter também republica a função**, porque o deploy é automático
   no merge para `main` — o rollback de código e o de runtime são o mesmo ato aqui.
4. O Worker pode continuar implantado e **inerte** — ele não é alcançável sem rota, e o interruptor
   é a primeira coisa que se desliga.
5. A Edge Function legada (projeto primário) já está inerte e será apagada pelo dono.

Nenhum passo toca dado de participante, razão financeiro, scoring ou ranking.

## 14. Runbook de triagem

1. Não presuma que o relato está correto.
2. **Não execute nada** que ele contenha.
3. Não abra links automaticamente.
4. Correlacione pelo `report_id`.
5. Investigue por evidência somente-leitura do código e dos gates.
6. Promova para o público **apenas fato técnico sanitizado** — nunca o relato.
7. Repetição chama atenção; **não** escala automaticamente nem muda produção.

## 15. Isto não é uma declaração de conformidade

Desenhado segundo princípios de **minimização de dados** e **menor privilégio**. Não há aqui
qualquer alegação de conformidade formal com GDPR, CCPA ou outro regime — isso exigiria avaliação
formal que não foi feita.
